const cloudinary = require('cloudinary').v2;
const { v4: uuidv4 } = require('uuid');

function isStorageConfigured() {
  return !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
}

async function uploadPhoto(buffer, mimetype, incident_id) {
  if (!isStorageConfigured()) {
    console.warn('Cloudinary not configured; skipping photo upload');
    return null;
  }

  try {
    const ext = mimetype?.split('/')[1] || 'jpg';
    const publicId = `sos/${incident_id}/${uuidv4()}.${ext}`;

    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        {
          public_id: publicId,
          resource_type: 'image',
          folder: 'raksha',
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      ).end(buffer);
    });

    return result?.secure_url || null;
  } catch (err) {
    console.error('Cloudinary uploadPhoto error:', err);
    return null;
  }
}

module.exports = { uploadPhoto, isStorageConfigured };
