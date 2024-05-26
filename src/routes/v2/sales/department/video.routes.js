// Packages
const express = require('express');
const router = express.Router();
const Multer = require('multer');

let processVideo = Multer({
  storage: Multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
});

let processThumbnail = Multer({
  storage: Multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Middlewares
const { auth } = require('../../../../middlewares/auth.middlewares');

// Controllers
const VideoController = require('../../../../controllers/v2/sales/department/video.controllers');

// Imports
router.get('/:video_tracking_id', VideoController.fetchVideo);

router.patch(
  '/set-thumbnail',
  [auth],
  processThumbnail.single('file'),
  VideoController.setThumbnail
);

router.post(
  '/upload-video',
  [auth],
  processVideo.single('file'),
  VideoController.uploadVideo
);

router.delete('/:video_id', [auth], VideoController.deleteVideo);

router.post('/tracking/:video_tracking_id', VideoController.trackVideo);

router.get('/stream/:video_id', VideoController.streamVideo);

module.exports = router;
