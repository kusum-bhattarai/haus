import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { parseEditIntent } from './editParser.js';
import { extractAnchorSpecs, generateAnchors } from './anchorGenerator.js';
import { findFloorPlan } from '../floorPlans.js';
import { createLayer1Payload } from '../layer1/index.js';
import { createLayer2Profile } from '../layer2/index.js';
import { createLayer3Handoff } from '../layer3/index.js';
import { runLayer5 } from '../layer5/index.js';
import { createCreativeAgent } from './creativeAgent.js';
import { createEvalAgent, routeEvalDecision } from './evalAgent.js';
import { createGenmediaAdapter } from './genmediaAdapter.js';
import { createJobManager, createRoomRuntime, JOB_STATES, ROOM_STATES } from './jobManager.js';

export async function createAgentRuntime(options = {}) {
  const jobManager = options.jobManager ?? createJobManager(options);
  const fastMode = options.fastMode ?? process.env.HAUS_FAST_MODE !== 'false';
  const creativeAgent = options.creativeAgent ?? await createCreativeAgent({
    rootDir: options.rootDir ?? process.cwd(),
    fastMode
  });
  const evalAgent = options.evalAgent ?? createEvalAgent(options);
  const genmedia = options.genmedia ?? createGenmediaAdapter(options);
  const autoApproveStills = options.autoApproveStills ?? process.env.HAUS_AUTO_APPROVE_STILLS === 'true';

  async function createJob(input, routeOptions = {}) {
    const floorPlan = (options.findFloorPlan ?? findFloorPlan)(input.floor_plan_id);
    if (!floorPlan) throw new Error(`Unknown floor_plan_id: ${input.floor_plan_id}`);

    const job = await jobManager.createJob({
      input,
      floorPlan: floorPlanForClient(floorPlan),
      runtime: { fast_mode: fastMode }
    });
    if (routeOptions.autoStart !== false) {
      setImmediate(() => {
        runJob(job.job_id, { floorPlan }).catch((error) => failJob(job.job_id, error));
      });
    }
    return job;
  }

  async function runJob(jobId, { floorPlan }) {
    await jobManager.updateJob(jobId, async (job) => {
      job.status = 'running';
      job.current_state = JOB_STATES.LAYERS_1_3_RUNNING;
    });
    await jobManager.emitEvent(jobId, {
      type: 'layers.started',
      state: JOB_STATES.LAYERS_1_3_RUNNING,
      message: 'Running Layers 1-3.'
    });

    const job = await jobManager.getJob(jobId);
    const payload = await (options.createLayer1Payload ?? createLayer1Payload)({
      floor_plan_image: floorPlan.imagePath,
      pinterest_board_url: job.input.pinterest_board_url,
      brief: job.input.brief ?? null,
      objects: Array.isArray(job.input.objects) ? job.input.objects : [],
      platform: job.input.platform ?? 'all'
    });
    const profile = await (options.createLayer2Profile ?? createLayer2Profile)(payload);
    const handoff = await (options.createLayer3Handoff ?? createLayer3Handoff)(profile, { skill: creativeAgent.skill });
    const rooms = handoff.room_generation_jobs.map(createRoomRuntime);

    await jobManager.updateJob(jobId, async (current) => {
      current.session_id = payload.session_id;
      current.payload = payload;
      current.profile = profile;
      current.handoff = handoff;
      current.rooms = rooms;
      current.current_state = JOB_STATES.LAYER3_READY;
    });
    await jobManager.emitEvent(jobId, {
      type: 'layer3.ready',
      state: JOB_STATES.LAYER3_READY,
      message: 'Layer 3 handoff is ready.'
    });

    await runAnchorPhase(jobId, handoff);
    await startStillPhase(jobId);
  }

  async function runAnchorPhase(jobId, handoff) {
    const anchorSpecs = extractAnchorSpecs(handoff);
    if (!anchorSpecs.length) return;

    await jobManager.emitEvent(jobId, {
      type: 'job.anchors.generating',
      state: JOB_STATES.LAYER3_READY,
      message: `Generating ${anchorSpecs.length} consistency anchor image${anchorSpecs.length !== 1 ? 's' : ''} for shared objects.`
    });

    const anchors = await generateAnchors(anchorSpecs, {
      genmedia,
      skillVersion: creativeAgent.skill.version
    });

    await jobManager.updateJob(jobId, async (job) => {
      job.artifacts.anchors = anchors;
    });

    const cacheHits = anchors.filter((a) => a.cache_hit).length;
    await jobManager.emitEvent(jobId, {
      type: 'job.anchors.ready',
      state: JOB_STATES.LAYER3_READY,
      message: `${anchors.length} anchor image${anchors.length !== 1 ? 's' : ''} ready (${cacheHits} cached). Starting room stills.`
    });
  }

  async function startStillPhase(jobId) {
    await jobManager.updateJob(jobId, async (job) => {
      job.status = 'running';
      job.current_state = JOB_STATES.ROOM_QUEUE_RUNNING;
      job.runtime.still_review_announced = false;
      job.runtime.video_phase_started = false;
      job.runtime.video_review_announced = false;
    });

    const job = await jobManager.getJob(jobId);
    await Promise.allSettled(
      job.rooms
        .filter((room) => room.state === ROOM_STATES.PENDING || room.state === ROOM_STATES.STILL_RETRYING)
        .sort((left, right) => left.sequence_index - right.sequence_index)
        .map((room) => runStillForRoom(jobId, room.room_id))
    );
  }

  async function startVideoPhase(jobId) {
    await jobManager.updateJob(jobId, async (job) => {
      job.status = 'running';
      job.current_state = JOB_STATES.ROOM_QUEUE_RUNNING;
      job.runtime.video_review_announced = false;
    });

    const job = await jobManager.getJob(jobId);
    await Promise.allSettled(
      job.rooms
        .filter((room) => room.review.still_approved && !room.review.video_approved && room.state !== ROOM_STATES.FAILED)
        .sort((left, right) => left.sequence_index - right.sequence_index)
        .map((room) => runVideoForRoom(jobId, room.room_id))
    );
  }

  async function runStillForRoom(jobId, roomId, failureContext = null) {
    await jobManager.updateJob(jobId, async (job) => {
      job.status = 'running';
      job.current_state = JOB_STATES.ROOM_QUEUE_RUNNING;
      job.runtime.video_phase_started = false;
    });
    await jobManager.updateRoom(jobId, roomId, async (room) => {
      room.state = failureContext ? ROOM_STATES.STILL_RETRYING : ROOM_STATES.STILL_PLANNING;
    });
    await jobManager.emitEvent(jobId, {
      type: 'room.still.planning',
      room_id: roomId,
      state: JOB_STATES.ROOM_QUEUE_RUNNING,
      message: 'Planning room still.'
    });

    const { job, roomJob, room } = await roomContext(jobId, roomId);
    const anchors = job.artifacts?.anchors ?? [];
    const stillPlan = creativeAgent.buildStillPlan({ handoff: job.handoff, roomJob, roomRuntime: room, failureContext, anchors });
    await jobManager.updateRoom(jobId, roomId, async (currentRoom) => {
      currentRoom.plans.still_plan = stillPlan;
      currentRoom.state = ROOM_STATES.STILL_GENERATING;
      currentRoom.still_attempt_count += 1;
      if (failureContext?.reference_pin_ids?.length) {
        currentRoom.review.reference_pin_ids = [...failureContext.reference_pin_ids];
      }
    });
    await jobManager.emitEvent(jobId, {
      type: 'room.still.started',
      room_id: roomId,
      state: JOB_STATES.ROOM_QUEUE_RUNNING,
      message: 'Generating room still.'
    });

    const artifact = await genmedia.executeCached({
      endpointId: stillPlan.model,
      params: stillPlan.params,
      skillVersion: stillPlan.skill_version,
      artifactName: 'still',
      timeoutMs: 3 * 60 * 1000,
      onProgress: (update) => {
        const pos = update?.position != null ? ` — position ${update.position + 1} in queue` : '';
        if (update?.status === 'IN_QUEUE') {
          jobManager.emitEvent(jobId, {
            type: 'room.still.queued',
            room_id: roomId,
            state: JOB_STATES.ROOM_QUEUE_RUNNING,
            message: `${room.room_name} still in queue${pos}.`
          }).catch(() => {});
        }
      }
    });
    if (artifact.cache_hit) {
      await jobManager.emitEvent(jobId, {
        type: 'generation.cache_hit',
        room_id: roomId,
        state: JOB_STATES.ROOM_QUEUE_RUNNING,
        message: 'Reused cached still generation.'
      });
    }

    await jobManager.updateRoom(jobId, roomId, async (currentRoom) => {
      currentRoom.artifacts.styled_image_path = artifact.path;
      currentRoom.artifacts.styled_image_url = artifact.url;
      currentRoom.state = ROOM_STATES.STILL_VALIDATING;
    });

    const evalResult = await evalAgent.evaluateStill({ artifact, roomJob });
    const decision = routeEvalDecision(evalResult);
    await jobManager.updateRoom(jobId, roomId, async (currentRoom) => {
      currentRoom.evals.push({ kind: 'still', ...evalResult });
      currentRoom.scores = evalResult.scores;
    });

    if (decision !== 'pass') {
      const latest = await jobManager.getJob(jobId);
      const currentRoom = latest.rooms.find((candidate) => candidate.room_id === roomId);
      if (currentRoom.still_attempt_count < currentRoom.max_still_attempts) {
        await jobManager.emitEvent(jobId, {
          type: 'room.still.retrying',
          room_id: roomId,
          state: JOB_STATES.ROOM_QUEUE_RUNNING,
          message: evalResult.message
        });
        return runStillForRoom(jobId, roomId, evalResult);
      }
    }

    await jobManager.updateRoom(jobId, roomId, async (currentRoom) => {
      currentRoom.state = ROOM_STATES.STILL_REVIEW_READY;
    });
    await jobManager.emitEvent(jobId, {
      type: 'room.still.review_ready',
      room_id: roomId,
      state: autoApproveStills ? JOB_STATES.ROOM_QUEUE_RUNNING : JOB_STATES.WAITING_FOR_HUMAN_REVIEW,
      message: autoApproveStills ? 'Still auto-approved.' : 'Still ready for human review.'
    });

    if (!autoApproveStills) {
      await syncStillReviewPhase(jobId);
    }

    if (autoApproveStills) {
      await approveStill(jobId, roomId, { approved: true, note: 'Auto-approved by HAUS_AUTO_APPROVE_STILLS.' });
    }
  }

  async function approveStill(jobId, roomId, approval) {
    await jobManager.updateRoom(jobId, roomId, async (room) => {
      room.review.still_approved = Boolean(approval.approved);
      room.review.still_note = approval.note ?? null;
      if (Array.isArray(approval.reference_pin_ids)) {
        room.review.reference_pin_ids = [...approval.reference_pin_ids];
      }
    });

    if (!approval.approved) {
      await jobManager.emitEvent(jobId, {
        type: 'room.still.rejected',
        room_id: roomId,
        state: JOB_STATES.ROOM_QUEUE_RUNNING,
        message: approval.note ?? 'Still rejected.'
      });
      return runStillForRoom(jobId, roomId, {
        failure_classes: ['style_mismatch'],
        message: approval.note ?? 'Human rejected still.',
        reference_pin_ids: approval.reference_pin_ids ?? []
      });
    }

    await jobManager.emitEvent(jobId, {
      type: 'room.still.approved',
      room_id: roomId,
      state: JOB_STATES.ROOM_QUEUE_RUNNING,
      message: 'Still approved.'
    });
    return syncStillReviewPhase(jobId);
  }

  async function runVideoForRoom(jobId, roomId, failureContext = null) {
    const { job, roomJob, room } = await roomContext(jobId, roomId);
    if (!room.review.still_approved) {
      throw new Error(`Room still must be approved before video generation: ${roomId}`);
    }

    await jobManager.updateJob(jobId, async (currentJob) => {
      currentJob.status = 'running';
      currentJob.current_state = JOB_STATES.ROOM_QUEUE_RUNNING;
      currentJob.runtime.video_review_announced = false;
    });
    await jobManager.updateRoom(jobId, roomId, async (currentRoom) => {
      currentRoom.state = failureContext ? ROOM_STATES.VIDEO_RETRYING : ROOM_STATES.VIDEO_PLANNING;
    });

    const sourceStillUrl = await ensureFalUrl(room.artifacts.styled_image_url, room.artifacts.styled_image_path);
    const videoPlan = creativeAgent.buildVideoPlan({ handoff: job.handoff, roomJob, sourceStillUrl, failureContext });

    await jobManager.updateRoom(jobId, roomId, async (currentRoom) => {
      currentRoom.plans.video_plan = videoPlan;
      currentRoom.current_motion_mode = videoPlan.camera_motion;
      currentRoom.state = ROOM_STATES.VIDEO_GENERATING;
      currentRoom.video_attempt_count += 1;
    });
    await jobManager.emitEvent(jobId, {
      type: 'room.video.started',
      room_id: roomId,
      state: JOB_STATES.ROOM_QUEUE_RUNNING,
      message: 'Generating room video.'
    });

    const artifact = await genmedia.executeCached({
      endpointId: videoPlan.model,
      params: videoPlan.params,
      sourcePaths: [room.artifacts.styled_image_path],
      skillVersion: videoPlan.skill_version,
      artifactName: 'video',
      timeoutMs: 10 * 60 * 1000,
      onProgress: (update) => {
        const pos = update?.position != null ? ` — position ${update.position + 1} in queue` : '';
        const isQueued = update?.status === 'IN_QUEUE';
        jobManager.emitEvent(jobId, {
          type: isQueued ? 'room.video.queued' : 'room.video.progress',
          room_id: roomId,
          state: JOB_STATES.ROOM_QUEUE_RUNNING,
          message: isQueued
            ? `${room.room_name} video in queue${pos}.`
            : `${room.room_name} video is rendering...`
        }).catch(() => {});
      }
    });
    if (artifact.cache_hit) {
      await jobManager.emitEvent(jobId, {
        type: 'generation.cache_hit',
        room_id: roomId,
        state: JOB_STATES.ROOM_QUEUE_RUNNING,
        message: 'Reused cached video generation.'
      });
    }

    await jobManager.updateRoom(jobId, roomId, async (currentRoom) => {
      currentRoom.artifacts.video_clip_path = artifact.path;
      currentRoom.artifacts.video_url = artifact.url;
      currentRoom.state = ROOM_STATES.VIDEO_VALIDATING;
    });

    const evalResult = await evalAgent.evaluateVideo({ artifact, roomJob });
    const decision = routeEvalDecision(evalResult);
    await jobManager.updateRoom(jobId, roomId, async (currentRoom) => {
      currentRoom.evals.push({ kind: 'video', ...evalResult });
      currentRoom.scores = evalResult.scores;
    });

    if (decision === 'pass') {
      await approveRoom(jobId, roomId);
      return syncVideoPhase(jobId);
    }

    const latest = await jobManager.getJob(jobId);
    const currentRoom = latest.rooms.find((candidate) => candidate.room_id === roomId);
    if (decision === 'retry_still') {
      return runStillForRoom(jobId, roomId, evalResult);
    }
    if (currentRoom.video_attempt_count < currentRoom.max_video_attempts) {
      await jobManager.emitEvent(jobId, {
        type: 'room.video.retrying',
        room_id: roomId,
        state: JOB_STATES.ROOM_QUEUE_RUNNING,
        message: evalResult.message
      });
      return runVideoForRoom(jobId, roomId, evalResult);
    }

    await jobManager.updateRoom(jobId, roomId, async (roomToUpdate) => {
      roomToUpdate.state = ROOM_STATES.VIDEO_REVIEW_READY;
    });
    await jobManager.updateJob(jobId, async (currentJob) => {
      currentJob.status = 'waiting';
      currentJob.current_state = JOB_STATES.WAITING_FOR_HUMAN_REVIEW;
    });
    await jobManager.emitEvent(jobId, {
      type: 'room.video.review_ready',
      room_id: roomId,
      state: JOB_STATES.WAITING_FOR_HUMAN_REVIEW,
      message: 'Video needs human review.'
    });
  }

  async function retryRoom(jobId, roomId, { target = 'video', note = null, referencePinIds = [] } = {}) {
    if (target === 'still' && referencePinIds.length) {
      await jobManager.updateRoom(jobId, roomId, async (room) => {
        room.review.reference_pin_ids = [...referencePinIds];
      });
    }
    await jobManager.emitEvent(jobId, {
      type: `room.${target}.manual_retry`,
      room_id: roomId,
      state: JOB_STATES.ROOM_QUEUE_RUNNING,
      message: note ?? `Manual ${target} retry requested.`
    });

    if (target === 'still') {
      await jobManager.updateJob(jobId, async (job) => {
        job.runtime.still_review_announced = false;
      });
      return runStillForRoom(jobId, roomId, {
        failure_classes: ['style_mismatch'],
        message: note,
        reference_pin_ids: referencePinIds
      });
    }
    return runVideoForRoom(jobId, roomId, { failure_classes: ['motion_unstable'], message: note });
  }

  async function editRoom(jobId, message, { roomId = null } = {}) {
    const job = await jobManager.getJob(jobId);
    if (!job.handoff?.room_generation_jobs?.length) {
      throw new Error('Job handoff not ready — cannot edit rooms yet.');
    }

    // If the user explicitly selected a room in the UI, skip the LLM parse.
    const validRoomIds = new Set(job.handoff.room_generation_jobs.map((r) => r.room_id));
    const parsed = (roomId && validRoomIds.has(roomId))
      ? { rooms: [roomId], directive: message }
      : await parseEditIntent(message, job.handoff.room_generation_jobs);

    await jobManager.updateJob(jobId, async (currentJob) => {
      currentJob.status = 'running';
      currentJob.current_state = JOB_STATES.ROOM_QUEUE_RUNNING;
      currentJob.runtime.video_phase_started = false;
      currentJob.runtime.still_review_announced = false;
      currentJob.artifacts.approved_room_clips = (currentJob.artifacts.approved_room_clips ?? []).filter(
        (clip) => !parsed.rooms.includes(clip.room_id)
      );
    });

    await Promise.all(parsed.rooms.map((roomId) =>
      jobManager.updateRoom(jobId, roomId, async (room) => {
        room.review.still_approved = false;
        room.review.video_approved = false;
        room.state = ROOM_STATES.STILL_RETRYING;
      })
    ));

    await jobManager.emitEvent(jobId, {
      type: 'job.edit.started',
      state: JOB_STATES.ROOM_QUEUE_RUNNING,
      message: `Regenerating ${parsed.rooms.length} room${parsed.rooms.length !== 1 ? 's' : ''}: ${parsed.directive}`
    });

    await Promise.allSettled(
      parsed.rooms.map((roomId) =>
        runStillForRoom(jobId, roomId, {
          failure_classes: ['user_edit_request'],
          message: parsed.directive
        })
      )
    );
  }

  async function approveRoom(jobId, roomId) {
    await jobManager.updateRoom(jobId, roomId, async (room) => {
      room.state = ROOM_STATES.APPROVED;
      room.review.video_approved = true;
    });
    await jobManager.updateJob(jobId, async (job) => {
      const room = job.rooms.find((candidate) => candidate.room_id === roomId);
      if (room?.artifacts?.video_clip_path) {
        // Replace any existing clip for this room so edits don't create duplicates.
        job.artifacts.approved_room_clips = job.artifacts.approved_room_clips.filter(
          (clip) => clip.room_id !== roomId
        );
        job.artifacts.approved_room_clips.push({
          room_id: room.room_id,
          path: room.artifacts.video_clip_path,
          url: room.artifacts.video_url
        });
      }
    });
    await jobManager.emitEvent(jobId, {
      type: 'room.approved',
      room_id: roomId,
      state: JOB_STATES.ROOM_QUEUE_RUNNING,
      message: 'Room clip approved.'
    });
  }

  async function syncStillReviewPhase(jobId) {
    const job = await jobManager.getJob(jobId);
    const rooms = job.rooms ?? [];
    const stillsInFlight = rooms.some((room) => [
      ROOM_STATES.PENDING,
      ROOM_STATES.STILL_PLANNING,
      ROOM_STATES.STILL_GENERATING,
      ROOM_STATES.STILL_VALIDATING,
      ROOM_STATES.STILL_RETRYING
    ].includes(room.state));

    if (stillsInFlight) return;

    const allStillsApproved = rooms.every((room) => room.review.still_approved);
    if (allStillsApproved) {
      if (job.runtime.video_phase_started) return;
      await jobManager.updateJob(jobId, async (currentJob) => {
        currentJob.status = 'running';
        currentJob.current_state = JOB_STATES.ROOM_QUEUE_RUNNING;
        currentJob.runtime.video_phase_started = true;
        currentJob.runtime.video_review_announced = false;
      });
      await jobManager.emitEvent(jobId, {
        type: 'job.stills.approved',
        state: JOB_STATES.ROOM_QUEUE_RUNNING,
        message: 'All room stills approved. Starting videos.'
      });
      return startVideoPhase(jobId);
    }

    if (!job.runtime.still_review_announced) {
      await jobManager.updateJob(jobId, async (currentJob) => {
        currentJob.status = 'waiting';
        currentJob.current_state = JOB_STATES.WAITING_FOR_HUMAN_REVIEW;
        currentJob.runtime.still_review_announced = true;
      });
      await jobManager.emitEvent(jobId, {
        type: 'job.stills.review_ready',
        state: JOB_STATES.WAITING_FOR_HUMAN_REVIEW,
        message: 'All room stills are ready for review.'
      });
    }
  }

  async function syncVideoPhase(jobId) {
    const job = await jobManager.getJob(jobId);
    const rooms = job.rooms ?? [];
    const videosInFlight = rooms.some((room) => [
      ROOM_STATES.VIDEO_PLANNING,
      ROOM_STATES.VIDEO_GENERATING,
      ROOM_STATES.VIDEO_VALIDATING,
      ROOM_STATES.VIDEO_RETRYING
    ].includes(room.state));

    if (videosInFlight) return;

    const allVideosApproved = rooms.every((room) => room.review.video_approved || room.state === ROOM_STATES.FAILED);
    if (allVideosApproved) {
      return completeJob(jobId);
    }

    const needsVideoReview = rooms.some((room) => room.state === ROOM_STATES.VIDEO_REVIEW_READY);
    if (needsVideoReview && !job.runtime.video_review_announced) {
      await jobManager.updateJob(jobId, async (currentJob) => {
        currentJob.status = 'waiting';
        currentJob.current_state = JOB_STATES.WAITING_FOR_HUMAN_REVIEW;
        currentJob.runtime.video_review_announced = true;
      });
      await jobManager.emitEvent(jobId, {
        type: 'job.videos.review_ready',
        state: JOB_STATES.WAITING_FOR_HUMAN_REVIEW,
        message: 'One or more room videos need review.'
      });
    }
  }

  async function completeJob(jobId) {
    await jobManager.updateJob(jobId, async (job) => {
      job.status = 'running';
      job.current_state = JOB_STATES.PACKAGING_OUTPUTS;
    });
    await jobManager.emitEvent(jobId, {
      type: 'job.packaging',
      state: JOB_STATES.PACKAGING_OUTPUTS,
      message: 'Assembling final video and generating captions.'
    });

    const job = await jobManager.getJob(jobId);
    const jobDir = path.join(jobManager.jobsDir, jobId);
    const roomOrder = new Map(job.rooms.map((r) => [r.room_id, r.sequence_index ?? 0]));
    const sortedClips = [...(job.artifacts.approved_room_clips ?? [])].sort(
      (a, b) => (roomOrder.get(a.room_id) ?? 0) - (roomOrder.get(b.room_id) ?? 0)
    );
    const jobForLayer5 = { ...job, artifacts: { ...job.artifacts, approved_room_clips: sortedClips } };
    const layer5 = await (options.runLayer5 ?? runLayer5)({ ...jobForLayer5, _job_dir: jobDir }).catch((err) => {
      console.error('[orchestrator] Layer 5 failed:', err.message);
      return { final_video_path: null, captions: null };
    });

    await jobManager.updateJob(jobId, async (current) => {
      current.status = 'completed';
      current.current_state = JOB_STATES.COMPLETED;
      current.artifacts.outputs = current.artifacts.approved_room_clips;
      current.artifacts.final_video_path = layer5.final_video_path;
      current.artifacts.captions = layer5.captions;
      current.artifacts.asset_bank = layer5.asset_bank ?? null;
      current.artifacts.asset_bank_path = layer5.asset_bank_path ?? null;
      current.artifacts.shot_manifest = layer5.shot_manifest ?? null;
      current.artifacts.shot_manifest_path = layer5.shot_manifest_path ?? null;
      current.artifacts.timeline = layer5.timeline ?? null;
      current.artifacts.timeline_path = layer5.timeline_path ?? null;
      current.artifacts.review_report = layer5.review_report ?? null;
      current.artifacts.review_report_path = layer5.review_report_path ?? null;
      current.artifacts.narration_script = layer5.narration_script ?? null;
      current.artifacts.voiceover_path = layer5.voiceover_path ?? null;
      current.artifacts.subtitles_path = layer5.subtitles_path ?? null;
    });
    await jobManager.emitEvent(jobId, {
      type: 'job.completed',
      state: JOB_STATES.COMPLETED,
      message: 'Your space is ready.'
    });
  }

  async function failJob(jobId, error) {
    await jobManager.updateJob(jobId, async (job) => {
      job.status = 'failed';
      job.current_state = JOB_STATES.FAILED;
      job.warnings.push({ code: 'agent_runtime_failed', message: error.message, severity: 'error' });
    }).catch(() => null);
    await jobManager.emitEvent(jobId, {
      type: 'job.failed',
      state: JOB_STATES.FAILED,
      message: error.message
    }).catch(() => null);
  }

  async function roomContext(jobId, roomId) {
    const job = await jobManager.getJob(jobId);
    const room = job.rooms.find((candidate) => candidate.room_id === roomId);
    const roomJob = job.handoff.room_generation_jobs.find((candidate) => candidate.room_id === roomId);
    if (!room || !roomJob) throw new Error(`Unknown room_id: ${roomId}`);
    return { job, room, roomJob };
  }

  async function ensureFalUrl(url, localPath) {
    if (url) return url;
    if (!localPath) throw new Error('No local still path available to upload.');
    const uploaded = await genmedia.upload(localPath);
    return uploaded.url;
  }

  return {
    jobManager,
    createJob,
    getJob: (jobId) => jobManager.getJob(jobId),
    subscribe: (jobId, listener) => jobManager.subscribe(jobId, listener),
    approveStill,
    retryRoom,
    editRoom,
    runJob,
    startStillPhase,
    startVideoPhase,
    delay
  };
}

function floorPlanForClient({ imagePath, ...plan }) {
  return plan;
}
