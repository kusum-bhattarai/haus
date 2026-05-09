import path from 'node:path';

export const FLOOR_PLANS = [
  {
    id: '1b1',
    name: 'Unit A1',
    layout: '1 Bedroom / 1 Bath',
    bedrooms: 1,
    bathrooms: 1,
    sqft: 689,
    displaySqft: '689 sq ft',
    price: 'Starting at $2,040',
    available: 'Available now',
    imagePath: path.resolve('frontend/floor_plans/1b1.png'),
    imageUrl: '/floor_plans/1b1.png'
  },
  {
    id: '2b2',
    name: 'Unit B2',
    layout: '2 Bedroom / 2 Bath',
    bedrooms: 2,
    bathrooms: 2,
    sqft: 988,
    displaySqft: '988 sq ft',
    price: 'Starting at $2,620',
    available: '2 homes left',
    imagePath: path.resolve('frontend/floor_plans/2b2.png'),
    imageUrl: '/floor_plans/2b2.png'
  },
  {
    id: '3b2',
    name: 'Unit C3',
    layout: '3 Bedroom / 2 Bath',
    bedrooms: 3,
    bathrooms: 2,
    sqft: 1250,
    displaySqft: '1,250 sq ft',
    price: 'Starting at $3,180',
    available: 'Available June 7',
    imagePath: path.resolve('frontend/floor_plans/3b2.png'),
    imageUrl: '/floor_plans/3b2.png'
  }
];

export function findFloorPlan(floorPlanId) {
  return FLOOR_PLANS.find((plan) => plan.id === floorPlanId);
}
