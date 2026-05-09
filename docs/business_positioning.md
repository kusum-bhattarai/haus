# Business Positioning

## Core Thesis

Haus makes property listings more emotionally legible.

Floor plans are abstract, empty unit photos are generic, and staged photos rarely
match a renter's taste. Haus lets a renter paste a public Pinterest board and
see the selected floor plan visualized through their own aesthetic. That makes
the property easier to imagine as a future home.

## Product Framing

Strong framing:

> Pick a floor plan. Paste your Pinterest board. See the apartment styled like
> your future life.

Commercially safer framing:

> Personalized visualization for floor plans, grounded in the real unit layout.

Avoid positioning Haus as "AI redesigns the apartment." The product should feel
like personalized leasing visualization, not fictional renovation.

## Why This Can Drive Value

Apartment leasing and property sales are emotional decisions constrained by
imagination. If a buyer or renter can see the space in their own aesthetic, the
property can feel more relevant and desirable.

Potential business value:

- higher floor plan engagement
- higher lead conversion
- more qualified tours
- differentiated listing pages
- reduced reliance on one-size-fits-all staging
- better personalization for leasing teams and listing portals

## Likely Buyers

- apartment communities
- property management companies
- new development leasing teams
- listing portals
- brokerages
- short-term rental operators
- staging and visualization agencies

## Product Guardrails

The visualization must not mislead users about the actual unit.

Guardrails:

- label output as `Personalized visualization`
- preserve the selected floor plan layout
- preserve room structure and dimensions when known
- avoid changing windows, walls, ceiling height, or major finishes
- avoid making rooms look materially larger or brighter than the source allows
- show the selected floor plan alongside generated output
- keep a clear before/after comparison

Recommended UI label:

> Personalized visualization, not an exact furnished unit photo. Styling
> preserves the selected unit layout and room structure.

## Frontend Implications

The frontend should make the user the center of the experience.

Recommended copy:

- Floor plan CTA: `Visualize with your style`
- Form title: `Bring your Pinterest aesthetic into this floor plan`
- Pinterest helper text: `Paste a public board with interiors, furniture,
  colors, or lifestyle inspiration.`
- Generate button: `Create my personalized preview`

The results page should include:

- before: selected floor plan
- after: generated lifestyle preview
- structured vibe report
- generated room stills
- clear personalized visualization disclaimer

## Demo Narrative

The hackathon story should be:

1. A renter finds a floor plan but cannot picture living there.
2. They paste a Pinterest board that already represents their taste.
3. Haus extracts their aesthetic and parses the floor plan.
4. Haus creates a structured vibe report.
5. Haus generates a personalized preview grounded in the unit layout.
6. The renter can refine the video with an AI edit agent.

This connects AI novelty to a real funnel problem: renters struggle to imagine
themselves in abstract or generic property listings.
