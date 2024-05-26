// Utils
const logger = require('../../../../utils/winston');
const {
  successResponse,
  serverErrorResponse,
  badRequestResponse,
} = require('../../../../utils/response');
const {
  METRICS_FILTER,
  LEAD_STATUS,
  AGENDA_FILTERS,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

// Packages
const { Op } = require('sequelize');

// Repositories
const UserRepository = require('../../../../../../Cadence-Brain/src/repository/user-repository');
const LeadRepository = require('../../../../../../Cadence-Brain/src/repository/lead.repository');
const ActivityRepository = require('../../../../../../Cadence-Brain/src/repository/activity.repository');
const AgendaRepository = require('../../../../../../Cadence-Brain/src/repository/agenda.repository');

// Helpers and services
const LeadHelper = require('../../../../../../Cadence-Brain/src/helper/lead');
const DashboardHelper = require('../../../../../../Cadence-Brain/src/helper/employee/dashboard.helper');

const getDashboardData = async (req, res) => {
  try {
    const [user, errForUser] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    if (errForUser) return serverErrorResponse(res, errForUser);

    let result = {
      new_lead: [],
      ongoing: [],
    };
    // * get new leads
    const newLeadsPromise = LeadRepository.getNewleads(req.user.user_id);

    // * get ongoing leads
    const ongoingLeadsPromise = LeadRepository.getOngoingLeads(
      req.user.user_id
    );

    // * get test web leads
    const testWebLeadsPromise = LeadRepository.getTestWebLeads(
      req.user.user_id
    );

    const [
      [newLeads, errForNewLeads],
      [ongoingLeads, errForOngoingLeads],
      [testWebLeads, errForTestWebLeads],
    ] = await Promise.all([
      newLeadsPromise,
      ongoingLeadsPromise,
      testWebLeadsPromise,
    ]);
    if (errForNewLeads)
      return serverErrorResponse(
        res,
        `Error occured while fetching new leads: ${errForNewLeads}.`
      );

    logger.info('Fetched new leads.');

    if (errForOngoingLeads)
      return serverErrorResponse(
        res,
        `Error occured while fetching ongoing leads: ${errForOngoingLeads}.`
      );

    logger.info('Fetched ongoing leads.');

    if (errForTestWebLeads)
      return serverErrorResponse(
        res,
        `Error occured while fetching test web leads: ${errForTestWebLeads}.`
      );

    logger.info('Fetched test_web leads.');

    result['new_lead'] = newLeads;
    result['ongoing'] = ongoingLeads;
    result['test_web'] = testWebLeads;

    const sortedOngoingLeadsPromise =
      LeadHelper.getSortedByRecentActivity(ongoingLeads);

    // * fetch agendas
    const pendingAgendasPromise = AgendaRepository.filterAgendas(
      AGENDA_FILTERS.TODAY,
      req.user.user_id,
      user.timezone
    );

    // * fetch user metrics
    const metricsPromise = DashboardHelper.getMetricsForUser(
      req.user.user_id,
      METRICS_FILTER.TODAY,
      user.timezone
    );

    const [
      sortedOngoingLeads,
      [pendingAgendas, errForAgendas],
      [metrics, metricErr],
    ] = await Promise.all([
      sortedOngoingLeadsPromise,
      pendingAgendasPromise,
      metricsPromise,
    ]);
    if (errForAgendas)
      return serverErrorResponse(
        `Error occured while fetching agendas: ${errForAgendas}.`
      );
    if (metricErr) return serverErrorResponse(res, metricErr);

    result['ongoing'] = sortedOngoingLeads;
    result['agendas'] = JSON.parse(JSON.stringify(pendingAgendas));

    return successResponse(
      res,
      'Data for sales dashboard fetched successfully.',
      { result, metrics }
    );
  } catch (err) {
    logger.error(`Error while fetching sales dashboard: `, err);
    return serverErrorResponse(res);
  }
};

const fixDashboardError = async (req, res) => {
  try {
    const [user, errForUser] = await UserRepository.findUserByQuery({
      user_id: req.body.user_id,
    });
    if (errForUser) return serverErrorResponse(res, err.message);

    const [ongoingLeads, errForOngoingLeads] =
      await LeadRepository.getLeadsByQuery({
        status: LEAD_STATUS.ONGOING,
        user_id: req.body.user_id,
      });
    if (errForOngoingLeads) return serverErrorResponse(res, err.message);

    successResponse(res, 'Started processing.');

    for (let lead of ongoingLeads) {
      const [activities, errForActivities] =
        await ActivityRepository.getActivitiesByQuery({
          lead_id: lead.lead_id,
        });

      if (!errForActivities && !activities.length)
        await LeadRepository.updateLead({
          lead_id: lead.lead_id,
          status: LEAD_STATUS.NEW_LEAD,
        });
    }

    return;
  } catch (err) {
    logger.error(`Error while fixing error: `, err);
    return serverErrorResponse(res, err.message);
  }
};

const getMetrics = async (req, res) => {
  try {
    const [user, errForUser] = await UserRepository.findUserByQuery({
      user_id: req.user.user_id,
    });
    if (errForUser) {
      return serverErrorResponse(res);
    }
    if (![...Object.values(METRICS_FILTER)].includes(req.params.filter)) {
      return badRequestResponse(res, 'Invalid filter.');
    }
    const [metrics, metricErr] = await DashboardHelper.getMetricsForUser(
      req.user.user_id,
      req.params.filter,
      user.timezone
    );
    if (metricErr) {
      logger.error(metricErr);
      return serverErrorResponse(res);
    }
    return successResponse(res, 'Fetched metrics successfully.', metrics);
  } catch (err) {
    logger.error(`Error while fetching metrics: `, err);
    return serverErrorResponse(res);
  }
};

const EmployeeContoller = {
  getDashboardData,
  getMetrics,
  fixDashboardError,
};

module.exports = EmployeeContoller;
