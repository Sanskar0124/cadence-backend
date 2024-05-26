// Packages
const express = require('express');
const router = express.Router();
const multer = require('multer');
var storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fieldSize: 5 * 1024 * 1024 } }); // Limit 5 MB

// Middlewares
const authMiddleware = require('../../../../../Cadence-Brain/src/middlewares/auth.middlewares');

// Controllers
const googleController = require('../../../controllers/v2/google/google.controllers.js');

//Routes
router.post(
  '/upload-image',
  [authMiddleware.auth],
  upload.single('file'),
  googleController.uploadImage
);

router.post(
  '/delete-image',
  [authMiddleware.auth],
  googleController.deleteImage
);

router.post(
  '/attachments',
  [authMiddleware.auth],
  upload.single('attachment'),
  googleController.uploadAttachment
);

module.exports = router;
