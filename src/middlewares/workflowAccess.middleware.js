const {
  WORKFLOW_LEVEL,
  RBAC_RESOURCES,
} = require('../../../Cadence-Brain/src/utils/enums');
const AccessControlMiddleware = require('./accessControl.middlewares');

const checkWorkFlowAccess = (action) => {
  return async (req, res, next) => {
    const { option } = req.query;

    if (
      option === WORKFLOW_LEVEL.CADENCE ||
      req.body.cadence_id ||
      req.params.workflow_id
    )
      AccessControlMiddleware.checkAccess(
        action,
        RBAC_RESOURCES.CADENCE_WORKFLOW
      )(req, res, next);
    else
      AccessControlMiddleware.checkAccess(
        action,
        RBAC_RESOURCES.COMPANY_WORKFLOW
      )(req, res, next);
  };
};

const workflowControlMiddleware = {
  checkWorkFlowAccess,
};

module.exports = workflowControlMiddleware;
