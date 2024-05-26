// Utils
const logger = require('../../../../utils/winston');
const {
  VIDEO_FORMAT,
} = require('../../../../../../Cadence-Brain/src/utils/enums');
const {
  DB_TABLES,
} = require('../../../../../../Cadence-Brain/src/utils/modelEnums');
const {
  successResponse,
  badRequestResponseWithDevMsg,
  notFoundResponseWithDevMsg,
  serverErrorResponseWithDevMsg,
} = require('../../../../utils/response');

// Packages
const { sequelize } = require('../../../../../../Cadence-Brain/src/db/models');
const { customAlphabet } = require('nanoid');
const alphabet = '0123456789abcdefghijklmnopqrstuv';
const nanoid = customAlphabet(alphabet, 32);

// Repositories
const Repository = require('../../../../../../Cadence-Brain/src/repository');

// Helpers and Services
const Storage = require('../../../../../../Cadence-Brain/src/services/Google/Storage');

const uploadVideo = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    let originalFileName = req.file.originalname;
    let fileExtension = originalFileName.split('.')[1];

    if (!Object.values(VIDEO_FORMAT).includes(fileExtension)) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'File format is not supported',
      });
    }

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        user_id: req.user.user_id,
      },
    });
    if (errForUser) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to upload video',
        error: `Error while fetching user: ${errForUser}`,
      });
    }
    if (!user) {
      t.rollback();
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to upload video',
        error: `User not found`,
      });
    }

    let fileName = nanoid();

    const [createVideo, errForCreateVideo] = await Repository.create({
      tableName: DB_TABLES.VIDEO,
      createObject: {
        user_id: req.user.user_id,
        file_name: fileName,
        video_duration: req.body.video_duration,
      },
    });
    if (errForCreateVideo) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to upload video',
        error: `Error while creating video: ${errForCreateVideo}`,
      });
    }

    const [url, err] = await Storage.Bucket.uploadVideo(
      req.file.buffer,
      fileName
    );
    if (err) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to upload video',
        error: `Error while uploading video: ${err}`,
      });
    }

    t.commit();
    return successResponse(res, {
      video_id: createVideo.video_id,
      file_name: createVideo.file_name,
      url: `${url}?video_id=${createVideo.video_id}`,
    });
  } catch (error) {
    t.rollback();
    logger.error(`Error while fetching video data:`, error);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while uplaoding video: ${error.message}`,
    });
  }
};

const setThumbnail = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { video_id, file_name } = req.body;

    if (!video_id || !file_name) {
      t.rollback();
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to set thumbnail',
        error: 'Video id or file name is missing',
      });
    }

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        user_id: req.user.user_id,
      },
    });
    if (errForUser) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to set thumbnail',
        error: `Error while fetching user: ${errForUser}`,
      });
    }
    if (!user) {
      t.rollback();
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to set thumbnail',
        error: `User not found.`,
      });
    }

    const [thumbnail, errForThumbnail] = await Repository.update({
      tableName: DB_TABLES.VIDEO,
      updateObject: {
        is_thumbnail_present: true,
      },
      query: {
        video_id: video_id,
        user_id: req.user.user_id,
      },
    });
    if (errForThumbnail) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to set thumbnail',
        error: `Error while updating thumbnail: ${errForThumbnail}`,
      });
    }

    const [url, err] = await Storage.Bucket.uploadThumbnail(
      req.file.buffer,
      file_name
    );
    if (err) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to set thumbnail',
        error: `Error while updating thumbnail: ${err}`,
      });
    }

    t.commit();
    return successResponse(res, url);
  } catch (error) {
    t.rollback();
    logger.error(`Error while fetching thumbnail image:`, error);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while setting thumbnail: ${error.message}`,
    });
  }
};

const deleteVideo = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { video_id } = req.params;

    const [user, errForUser] = await Repository.fetchOne({
      tableName: DB_TABLES.USER,
      query: {
        user_id: req.user.user_id,
      },
    });
    if (errForUser) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete thumbnail',
        error: `Error while fetching user: ${errForUser}`,
      });
    }
    if (!user) {
      t.rollback();
      return notFoundResponseWithDevMsg({
        res,
        msg: 'Failed to delete thumbnail',
        error: `User not found`,
      });
    }

    const [gcpVideo, errForGcpVideo] = await Repository.fetchOne({
      tableName: DB_TABLES.VIDEO,
      query: {
        video_id: video_id,
        user_id: req.user.user_id,
      },
      extras: {
        attributes: ['file_name', 'is_thumbnail_present'],
      },
    });
    if (errForGcpVideo) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete thumbnail',
        error: `Error while fetching video: ${errForGcpVideo}`,
      });
    }

    const [deleteVideo, errForDelete] = await Repository.destroy({
      tableName: DB_TABLES.VIDEO,
      query: { video_id: video_id },
    });
    if (errForDelete) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete thumbnail',
        error: `Error while deleting video: ${errForDelete}`,
      });
    }

    const [videoStatus, err] = await Storage.Bucket.deleteVideo(
      gcpVideo.file_name
    );
    if (err) {
      t.rollback();
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to delete thumbnail',
        error: `Error while deleting video: ${err}`,
      });
    }

    if (gcpVideo.is_thumbnail_present) {
      const [thumbnailStatus, err] = await Storage.Bucket.deleteThumbnail(
        gcpVideo.file_name
      );
      if (err) {
        t.rollback();
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to delete thumbnail',
          error: `Error while deleting thumbnail: ${err}`,
        });
      }
    }

    t.commit();
    return successResponse(res, 'Video deleted successfully.');
  } catch (error) {
    t.rollback();
    logger.error(`Error while deleting video:`, error);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while deleting video: ${error.message}`,
    });
  }
};

const trackVideo = async (req, res) => {
  try {
    const { video_tracking_id } = req.params;

    const { watch_duration } = req.query;
    if (!watch_duration) {
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to track video',
        error: 'Watch duration is missing',
      });
    }

    const [vidoStats, errForVidoStats] = await Repository.fetchOne({
      tableName: DB_TABLES.VIDEO_TRACKING,
      query: { video_tracking_id },
      extras: {
        attributes: ['watch_duration'],
      },
    });
    if (errForVidoStats)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to track video',
        error: `Error while fetching video tracking: ${errForVidoStats}`,
      });

    if (vidoStats.watch_duration < watch_duration) {
      const [watchDuration, errForWatchDuration] = await Repository.update({
        tableName: DB_TABLES.VIDEO_TRACKING,
        updateObject: { watch_duration },
        query: { video_tracking_id },
      });
      if (errForWatchDuration)
        return serverErrorResponseWithDevMsg({
          res,
          msg: 'Failed to track video',
          error: `Error while updating video tracking: ${errForWatchDuration}`,
        });
    }

    return successResponse(res, 'Video stats updated successfully.');
  } catch (error) {
    logger.error(`Error while updating video statistics:`, error);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while tracking video: ${error.message}`,
    });
  }
};

const fetchVideo = async (req, res) => {
  try {
    const { video_tracking_id } = req.params;

    const [videoId, errForVideoId] = await Repository.fetchOne({
      tableName: DB_TABLES.VIDEO_TRACKING,
      query: { video_tracking_id },
      extras: {
        attributes: ['video_id'],
      },
    });
    if (errForVideoId)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch video',
        error: `Error while fetching video:  ${errForVideoId}`,
      });

    const [videoData, errForVideoData] = await Repository.fetchOne({
      tableName: DB_TABLES.VIDEO,
      query: { video_id: videoId.video_id },
      extras: {
        attributes: [
          'video_id',
          'video_duration',
          'file_name',
          'is_thumbnail_present',
          'thumbnail_url',
        ],
      },
    });
    if (errForVideoData)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch video',
        error: `Error while fetching video: ${errForVideoData}`,
      });

    const [visited, errForVisited] = await Repository.update({
      tableName: DB_TABLES.VIDEO_TRACKING,
      updateObject: { is_visited: true },
      query: { video_tracking_id },
    });
    if (errForVisited)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to fetch video',
        error: `Error while updating video tracking: ${errForVisited}`,
      });

    return successResponse(res, 'Video fetched successfully.', videoData);
  } catch (error) {
    logger.error(`Error while fetching video duration:`, error);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while fetching video: ${error.message}`,
    });
  }
};

const streamVideo = async (req, res) => {
  try {
    const { video_id } = req.params;

    if (!video_id)
      return badRequestResponseWithDevMsg({
        res,
        msg: 'Failed to stream video',
        error: 'Video id is missing',
      });

    const [videoData, errForVideoData] = await Repository.fetchOne({
      tableName: DB_TABLES.VIDEO,
      query: { video_id },
      extras: {
        attributes: ['file_name'],
      },
    });
    if (errForVideoData)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to stream video',
        error: `Error while fetching video: ${errForVideoData}`,
      });

    const [remoteFile, err] = await Storage.Bucket.video(videoData.file_name);
    if (err)
      return serverErrorResponseWithDevMsg({
        res,
        msg: 'Failed to stream video',
        error: `Error while streaming video: ${err}`,
      });

    const [file] = await remoteFile.getMetadata();
    const fileSize = file.size;

    let range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Type': 'video/mp4',
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
      });

      return remoteFile.createReadStream({ start, end }).pipe(res);
    } else {
      range = 'bytes=0-';
    }
  } catch (err) {
    logger.error(`Error while streaming video:`, err);
    return serverErrorResponseWithDevMsg({
      res,
      error: `Error while streaming video: ${err.message}`,
    });
  }
};

const VideoControllers = {
  setThumbnail,
  uploadVideo,
  deleteVideo,
  fetchVideo,
  trackVideo,
  streamVideo,
};

module.exports = VideoControllers;
