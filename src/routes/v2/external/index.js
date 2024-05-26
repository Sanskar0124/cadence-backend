// Pacakages
const express = require('express');
const router = express();

// Middlwares
const { externalAuth } = require('../../../middlewares/external.middlewares');
const { devAuth } = require('../../../middlewares/dev.middlewares');

// Controllers
const externalController = require('../../../controllers/v2/external/external.controllers');
const leadController = require('../../../controllers/v2/external/lead.controllers');
const cadenceController = require('../../../controllers/v2/external/cadence.controllers');

// Routes
router.post('/stop', externalAuth, externalController.stopCadenceExternal);
router.put('/:company_id', devAuth, externalController.updateCompanyInfo);
router.get('/lead/types', externalAuth, leadController.getLeadIntegrationTypes);
router.post('/lead/create', externalAuth, leadController.createLead);
router.get('/cadence', externalAuth, cadenceController.getAllCadence);
module.exports = router;
