// Utils
const logger = require('../../../../utils/winston');
const {
  successResponse,
  notFoundResponse,
  serverErrorResponse,
  badRequestResponse,
} = require('../../../../utils/response');

// Repositories
const CadenceRepository = require('../../../../../../Cadence-Brain/src/repository/cadence.repository');
const LeadToCadenceRepository = require('../../../../../../Cadence-Brain/src/repository/lead-to-cadence.repository');

const getCadences = async (req, res) => {
  try {
    const [cadences, err] = await CadenceRepository.getCadences(
      {},
      (includeLinkedModel = false)
    );
    if (err) return serverErrorResponse(res);
    if (cadences.length === 0)
      return notFoundResponse(res, 'No cadences found');

    return successResponse(res, 'Cadences fetched successfully', cadences);
  } catch (err) {
    logger.error(`Error while fetching cadences: ${err.message}`);
    return serverErrorResponse(res, err.message);
  }
};

const getCadenceUsers = async (req, res) => {
  try {
    let cadence_id = req.params.id;
    if (cadence_id == null)
      return badRequestResponse(res, 'Cadence id not valid');

    // Get cadence info
    const [cadence, errForCadence] = await CadenceRepository.getCadence({
      cadence_id,
    });
    if (errForCadence) {
      if (errForCadence === 'No cadence found.')
        return notFoundResponse(res, errForCadence);
      return serverErrorResponse(res, errForCadence);
    }
    if (!cadence) return notFoundResponse(res);
    let cadenceInfo = {
      id: cadence.cadence_id,
      name: cadence.name,
      status: cadence.status,
      priority: cadence.priority,
    };

    // * get leads for the cadence
    const [cadenceLeads, errForCadenceLeads] =
      await LeadToCadenceRepository.getLeadToCadenceLinksByLeadQuery(
        {
          cadence_id,
        },
        {}
      );
    if (errForCadenceLeads) return serverErrorResponse(res, errForCadenceLeads);

    let owners = {};

    // * seperate leads from cadenceLeads
    cadenceLeads.map((cadenceLead) => {
      cadenceLead = JSON.parse(JSON.stringify(cadenceLead));
      if (cadenceLead.Leads && cadenceLead.Leads.length > 0) {
        let lead = cadenceLead.Leads[0];
        if (cadenceLead.Leads[0].User) {
          let userName = `${lead.User.first_name} ${lead.User.last_name}`;
          if (owners[userName]) owners[userName]++;
          else owners[userName] = 1;
        }
      }
    });

    return successResponse(res, 'Cadence fetched successfully', {
      cadenceInfo,
      users: owners,
    });
  } catch (err) {
    logger.error(`Error while fetching cadences: ${err.message}`);
    return serverErrorResponse(res, err.message);
  }
};

module.exports = {
  getCadences,
  getCadenceUsers,
};
