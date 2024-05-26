//Packages
const express = require('express');
const router = express.Router();
const multer = require('multer');
var storage = multer.memoryStorage();
var upload = multer({ storage: storage });

//Middleware
const { auth } = require('../../../middlewares/auth.middlewares');

// Controllers
const chatbotController = require('../../../controllers/v2/chatbot/chatbot.controllers');

router.post(
  '/send-message',
  auth,
  upload.single('file'),
  chatbotController.sendMessage
);
router.get('/pending-issues', auth, chatbotController.getPendingIssues);
router.post('/receive-message', chatbotController.receiveMessage);
router.get('/resolve-issue', auth, chatbotController.resolveIssue);
router.get(
  '/current-conversation',
  auth,
  chatbotController.getCurrentConversation
);
router.post('/public-url', chatbotController.getPublicURL);
router.get('/grant-access', auth, chatbotController.grantSupportAgentAccess);
router.get('/login-as-user', auth, chatbotController.supportAgentLoginAsUser);

module.exports = router;
