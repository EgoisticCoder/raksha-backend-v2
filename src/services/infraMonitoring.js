
/**
 * Infrastructure & Cost Monitoring
 * Checks usage against free tier limits
 */

const { v2: cloudinary } = require('cloudinary');
const { driver } = require('./neo4j');

// Free tier limits (approximate, adjust as needed)
const NEO4J_FREE_LIMITS = {
  nodes: 200000,
  relationships: 200000,
};

const CLOUDINARY_FREE_LIMITS = {
  monthly_credits: 25, // 25 credits per month
  storage: 25, // 25 GB
  bandwidth: 25, // 25 GB
};

async function getNeo4jUsage() {
  const session = driver.session();
  try {
    // Get approximate node/rel counts
    const nodeCountResult = await session.run('MATCH (n) RETURN count(n) AS nodeCount');
    const relCountResult = await session.run('MATCH ()-[r]->() RETURN count(r) AS relCount');
    
    const nodeCount = nodeCountResult.records[0].get('nodeCount').low || 0;
    const relCount = relCountResult.records[0].get('relCount').low || 0;
    
    const nodeUsagePercent = (nodeCount / NEO4J_FREE_LIMITS.nodes) * 100;
    const relUsagePercent = (relCount / NEO4J_FREE_LIMITS.relationships) * 100;
    
    return {
      nodeCount,
      relCount,
      nodeUsagePercent: Math.min(100, nodeUsagePercent),
      relUsagePercent: Math.min(100, relUsagePercent),
      limits: NEO4J_FREE_LIMITS,
    };
  } catch (err) {
    console.error('Error getting Neo4j usage:', err);
    return {
      nodeCount: 0,
      relCount: 0,
      nodeUsagePercent: 0,
      relUsagePercent: 0,
      limits: NEO4J_FREE_LIMITS,
      error: err.message,
    };
  } finally {
    await session.close();
  }
}

async function getCloudinaryUsage() {
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    return {
      error: 'Cloudinary credentials not configured',
      limits: CLOUDINARY_FREE_LIMITS,
    };
  }

  try {
    // This keeps the dashboard endpoint stable until Cloudinary usage metrics are wired in.
    return {
      monthlyCreditsUsed: 0,
      storageUsed: 0, // GB
      bandwidthUsed: 0, // GB
      limits: CLOUDINARY_FREE_LIMITS,
    };
  } catch (err) {
    console.error('Error getting Cloudinary usage:', err);
    return {
      error: err.message,
      limits: CLOUDINARY_FREE_LIMITS,
    };
  }
}

module.exports = {
  getNeo4jUsage,
  getCloudinaryUsage,
};
