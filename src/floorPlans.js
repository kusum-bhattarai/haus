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
    imageUrl: '/floor_plans/1b1.svg',
    hotspots: [
      { key: 'dream-1', label: 'Dream', roomType: 'bedroom', occurrence: 0, points: '13,9 50,9 50,39 13,39' },
      { key: 'revive-1', label: 'Revive', roomType: 'bathroom', occurrence: 0, points: '72,9 96,9 96,31 72,31' },
      { key: 'surf-1', label: 'Surf', roomType: 'foyer', occurrence: 0, points: '26,37 50,37 50,53 26,53' },
      { key: 'taste-1', label: 'Taste', roomType: 'kitchen', occurrence: 0, points: '64,43 94,43 94,69 64,69' },
      { key: 'nest-1', label: 'Nest', roomType: 'living_room', occurrence: 0, points: '17,53 63,53 63,86 17,86' },
      { key: 'dine-1', label: 'Dine', roomType: 'dining', occurrence: 0, points: '62,55 93,55 93,78 62,78' },
      { key: 'relax-1', label: 'Relax', roomType: 'patio', occurrence: 0, points: '32,74 60,74 60,92 32,92' }
    ]
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
    imageUrl: '/floor_plans/2b2.svg',
    hotspots: [
      { key: 'dream-1', label: 'Dream', roomType: 'bedroom', occurrence: 0, points: '18,10 66,10 66,35 18,35' },
      { key: 'relax-1', label: 'Relax', roomType: 'patio', occurrence: 0, points: '76,5 96,5 96,34 76,34' },
      { key: 'revive-1', label: 'Revive', roomType: 'bathroom', occurrence: 0, points: '3,19 21,19 21,42 3,42' },
      { key: 'revive-2', label: 'Revive', roomType: 'bathroom', occurrence: 1, points: '3,43 21,43 21,61 3,61' },
      { key: 'taste-1', label: 'Taste', roomType: 'kitchen', occurrence: 0, points: '43,34 79,34 79,58 43,58' },
      { key: 'dine-1', label: 'Dine', roomType: 'dining', occurrence: 0, points: '80,34 98,34 98,61 80,61' },
      { key: 'dream-2', label: 'Dream', roomType: 'bedroom', occurrence: 1, points: '13,56 44,56 44,92 13,92' },
      { key: 'nest-1', label: 'Nest', roomType: 'living_room', occurrence: 0, points: '48,54 92,54 92,88 48,88' },
      { key: 'surf-1', label: 'Surf', roomType: 'foyer', occurrence: 0, points: '47,62 60,62 60,83 47,83' }
    ]
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
    imageUrl: '/floor_plans/3b2.svg',
    hotspots: [
      { key: 'watch-1', label: 'Watch', roomType: 'other', occurrence: 0, points: '46,0 61,0 61,8 46,8' },
      { key: 'nest-1', label: 'Nest', roomType: 'living_room', occurrence: 0, points: '38,8 70,8 70,28 38,28' },
      { key: 'relax-1', label: 'Relax', roomType: 'patio', occurrence: 0, points: '70,9 94,9 94,31 70,31' },
      { key: 'dream-1', label: 'Dream', roomType: 'bedroom', occurrence: 0, points: '4,33 26,33 26,57 4,57' },
      { key: 'taste-1', label: 'Taste', roomType: 'kitchen', occurrence: 0, points: '53,31 81,31 81,52 53,52' },
      { key: 'dine-1', label: 'Dine', roomType: 'dining', occurrence: 0, points: '81,31 98,31 98,56 81,56' },
      { key: 'revive-1', label: 'Revive', roomType: 'bathroom', occurrence: 0, points: '3,57 23,57 23,77 3,77' },
      { key: 'surf-1', label: 'Surf', roomType: 'foyer', occurrence: 0, points: '45,53 57,53 57,70 45,70' },
      { key: 'dream-2', label: 'Dream', roomType: 'bedroom', occurrence: 1, points: '54,55 84,55 84,78 54,78' },
      { key: 'dream-3', label: 'Dream', roomType: 'bedroom', occurrence: 2, points: '22,70 56,70 56,98 22,98' }
    ]
  }
];

export function findFloorPlan(floorPlanId) {
  return FLOOR_PLANS.find((plan) => plan.id === floorPlanId);
}
