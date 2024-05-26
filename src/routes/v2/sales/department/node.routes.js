// Packages
const express = require('express');
const router = express.Router();

// Middlewares
const { auth } = require('../../../../middlewares/auth.middlewares');

// Controllers
const nodeController = require('../../../../controllers/v2/sales/department/node.controller');

router.get('/stats/:node_id', [auth], nodeController.getNodeStats);

module.exports = router;
