require('dotenv').config();
const neo4j = require('neo4j-driver');
const { driver } = require('../src/services/neo4j');

const TEAMS = [
  { id: 'TEAM-001', name: 'Guwahati Rescue Alpha', lat: 26.1445, lng: 91.7362, status: 'available' },
  { id: 'TEAM-002', name: 'Silchar Flood Unit', lat: 24.8333, lng: 92.7789, status: 'available' },
  { id: 'TEAM-003', name: 'Dibrugarh Medical', lat: 27.4728, lng: 94.912, status: 'available' },
  { id: 'TEAM-004', name: 'Kolkata East Response', lat: 22.5726, lng: 88.3639, status: 'available' },
  { id: 'TEAM-005', name: 'Darjeeling Hills Rescue', lat: 27.041, lng: 88.2663, status: 'available' },
];

const RESOURCES = [
  { id: 'RES-001', name: 'Medical Kits', quantity: 50, minimum_threshold: 20, unit: 'kits' },
  { id: 'RES-002', name: 'Water Purifiers', quantity: 15, minimum_threshold: 10, unit: 'units' },
  { id: 'RES-003', name: 'Rescue Boats', quantity: 8, minimum_threshold: 5, unit: 'boats' },
  { id: 'RES-004', name: 'Emergency Rations', quantity: 200, minimum_threshold: 100, unit: 'packs' },
  { id: 'RES-005', name: 'Portable Generators', quantity: 6, minimum_threshold: 4, unit: 'units' },
  { id: 'RES-006', name: 'Tents', quantity: 30, minimum_threshold: 15, unit: 'tents' },
  { id: 'RES-007', name: 'Oxygen Cylinders', quantity: 12, minimum_threshold: 8, unit: 'cylinders' },
  { id: 'RES-008', name: 'Rescue Ropes', quantity: 40, minimum_threshold: 20, unit: 'ropes' },
  { id: 'RES-009', name: 'Satellite Phones', quantity: 3, minimum_threshold: 5, unit: 'phones' },
  { id: 'RES-010', name: 'First Aid Supplies', quantity: 80, minimum_threshold: 50, unit: 'kits' },
];

async function createConstraints(session) {
  const constraints = [
    'CREATE CONSTRAINT sos_incident_id IF NOT EXISTS FOR (s:SOSEvent) REQUIRE s.incident_id IS UNIQUE',
    'CREATE CONSTRAINT person_id IF NOT EXISTS FOR (p:Person) REQUIRE p.id IS UNIQUE',
    'CREATE CONSTRAINT team_id IF NOT EXISTS FOR (t:Team) REQUIRE t.id IS UNIQUE',
    'CREATE CONSTRAINT resource_id IF NOT EXISTS FOR (r:Resource) REQUIRE r.id IS UNIQUE',
  ];
  for (const cypher of constraints) {
    try {
      await session.run(cypher);
    } catch (err) {
      console.warn('Constraint may already exist:', err.message);
    }
  }
}

async function seedTeams(session) {
  for (const team of TEAMS) {
    await session.run(
      `MERGE (t:Team {id: $id})
       SET t.name = $name, t.lat = $lat, t.lng = $lng, t.status = $status`,
      team
    );
  }
  console.log(`Seeded ${TEAMS.length} teams`);
}

async function seedResources(session) {
  for (const resource of RESOURCES) {
    await session.run(
      `MERGE (r:Resource {id: $id})
       SET r.name = $name, r.quantity = $quantity,
           r.minimum_threshold = $minimum_threshold, r.unit = $unit
       WITH r
       MATCH (t:Team {id: 'TEAM-001'})
       MERGE (t)-[:HAS]->(r)`,
      {
        ...resource,
        quantity: neo4j.int(resource.quantity),
        minimum_threshold: neo4j.int(resource.minimum_threshold),
      }
    );
  }
  console.log(`Seeded ${RESOURCES.length} resources`);
}

async function main() {
  const session = driver.session();
  try {
    await createConstraints(session);
    await seedTeams(session);
    await seedResources(session);
    console.log('Seed completed successfully');
  } catch (err) {
    console.error('Seed failed:', err);
    process.exit(1);
  } finally {
    await session.close();
    await driver.close();
  }
}

main();
