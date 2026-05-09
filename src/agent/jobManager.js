import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { DEFAULT_CACHE_DIR } from '../layer1/constants.js';

export const JOB_STATES = {
  CREATED: 'CREATED',
  LAYERS_1_3_RUNNING: 'LAYERS_1_3_RUNNING',
  LAYER3_READY: 'LAYER3_READY',
  ROOM_QUEUE_RUNNING: 'ROOM_QUEUE_RUNNING',
  WAITING_FOR_HUMAN_REVIEW: 'WAITING_FOR_HUMAN_REVIEW',
  PACKAGING_OUTPUTS: 'PACKAGING_OUTPUTS',
  COMPLETED: 'COMPLETED',
  PARTIAL_READY: 'PARTIAL_READY',
  FAILED: 'FAILED'
};

export const ROOM_STATES = {
  PENDING: 'PENDING',
  STILL_PLANNING: 'STILL_PLANNING',
  STILL_GENERATING: 'STILL_GENERATING',
  STILL_VALIDATING: 'STILL_VALIDATING',
  STILL_RETRYING: 'STILL_RETRYING',
  STILL_REVIEW_READY: 'STILL_REVIEW_READY',
  VIDEO_PLANNING: 'VIDEO_PLANNING',
  VIDEO_GENERATING: 'VIDEO_GENERATING',
  VIDEO_VALIDATING: 'VIDEO_VALIDATING',
  VIDEO_RETRYING: 'VIDEO_RETRYING',
  VIDEO_REVIEW_READY: 'VIDEO_REVIEW_READY',
  APPROVED: 'APPROVED',
  FAILED: 'FAILED'
};

export function createJobManager(options = {}) {
  const rootDir = path.resolve(options.cacheDir ?? DEFAULT_CACHE_DIR, 'agent');
  const jobsDir = path.join(rootDir, 'jobs');
  const emitter = new EventEmitter();
  const memory = new Map();

  return {
    rootDir,
    jobsDir,

    async createJob({ input, floorPlan = null, runtime = null }) {
      const now = timestamp();
      const job = {
        schema_version: '1.0',
        job_id: options.jobIdFactory?.() ?? randomUUID(),
        session_id: null,
        status: 'queued',
        current_state: JOB_STATES.CREATED,
        created_at: now,
        updated_at: now,
        input,
        floor_plan: floorPlan,
        runtime: runtime ?? {},
        payload: null,
        profile: null,
        handoff: null,
        rooms: [],
        artifacts: {
          approved_room_clips: [],
          final_video_path: null,
          outputs: []
        },
        events: [],
        warnings: []
      };

      await persist(job);
      await this.emitEvent(job.job_id, {
        type: 'job.created',
        state: JOB_STATES.CREATED,
        message: 'Job created.'
      });
      return job;
    },

    async getJob(jobId) {
      if (memory.has(jobId)) return memory.get(jobId);

      const filePath = jobPath(jobId);
      const job = JSON.parse(await readFile(filePath, 'utf8'));
      memory.set(jobId, job);
      return job;
    },

    async updateJob(jobId, updater) {
      const job = await this.getJob(jobId);
      await updater(job);
      job.updated_at = timestamp();
      await persist(job);
      return job;
    },

    async updateRoom(jobId, roomId, updater) {
      return this.updateJob(jobId, async (job) => {
        const room = job.rooms.find((candidate) => candidate.room_id === roomId);
        if (!room) throw new Error(`Unknown room_id: ${roomId}`);
        await updater(room, job);
      });
    },

    async emitEvent(jobId, event) {
      const job = await this.getJob(jobId).catch(() => null);
      const fullEvent = {
        event_id: options.eventIdFactory?.() ?? randomUUID(),
        at: timestamp(),
        room_id: event.room_id ?? null,
        ...event
      };

      if (job) {
        job.events.push(fullEvent);
        job.updated_at = fullEvent.at;
        await persist(job);
      }

      await mkdir(jobDir(jobId), { recursive: true });
      await appendFile(eventsPath(jobId), `${JSON.stringify(fullEvent)}\n`);
      emitter.emit(jobId, fullEvent);
      return fullEvent;
    },

    subscribe(jobId, listener) {
      emitter.on(jobId, listener);
      return () => emitter.off(jobId, listener);
    }
  };

  async function persist(job) {
    await mkdir(jobDir(job.job_id), { recursive: true });
    memory.set(job.job_id, job);
    await writeFile(jobPath(job.job_id), `${JSON.stringify(job, null, 2)}\n`);
  }

  function jobDir(jobId) {
    return path.join(jobsDir, jobId);
  }

  function jobPath(jobId) {
    return path.join(jobDir(jobId), 'job.json');
  }

  function eventsPath(jobId) {
    return path.join(jobDir(jobId), 'events.jsonl');
  }
}

function timestamp() {
  return new Date().toISOString();
}

export function createRoomRuntime(roomJob) {
  return {
    room_id: roomJob.room_id,
    room_name: roomJob.room_name,
    room_type: roomJob.room_type,
    sequence_index: roomJob.sequence_index,
    state: ROOM_STATES.PENDING,
    still_attempt_count: 0,
    video_attempt_count: 0,
    max_still_attempts: 2,
    max_video_attempts: roomJob.quality_gate?.max_video_attempts ?? 3,
    current_motion_mode: roomJob.video_generation?.camera_motion ?? null,
    scores: {},
    artifacts: {
      source_image_path: null,
      styled_image_path: null,
      styled_image_url: null,
      video_clip_path: null,
      video_url: null
    },
    plans: {
      still_plan: null,
      image_edit_plan: null,
      video_plan: null
    },
    evals: [],
    review: {
      still_approved: false,
      still_note: null,
      reference_pin_ids: [],
      video_approved: false,
      video_note: null
    }
  };
}
