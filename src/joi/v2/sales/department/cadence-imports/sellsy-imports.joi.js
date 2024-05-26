// Packages
const Joi = require('joi');

const fetchSheetsColumnsSchema = Joi.object({
  url: Joi.string().label('google sheet url').required(),
});

const contactListSchema = Joi.object({
  order: Joi.string().default('created_at').valid('id', 'name', 'created_at'),
  direction: Joi.string().default('desc').valid('desc', 'asc'),
  limit: Joi.number().default(100).max(100),
  offset: Joi.number().default(0),
  filters: Joi.object({
    companies: Joi.array().items(Joi.number()).optional(),
    individuals: Joi.array().items(Joi.number()).optional(),
    created: Joi.object({
      start: Joi.string(),
      end: Joi.string(),
    }).optional(),
    updated: Joi.object({
      start: Joi.string(),
      end: Joi.string(),
    }).optional(),
    last_name: Joi.string().optional(),
    birth_date: Joi.object({
      start: Joi.string(),
      end: Joi.string(),
    }).optional(),
    email: Joi.string().optional(),
    phone_number: Joi.string().optional(),
    mobile_phone: Joi.string().optional(),
    id: Joi.array().items(Joi.number()).optional(),
  }),
});

// * Parse CSV request validation
const csvImportSchema = Joi.object({
  loaderId: Joi.string().required().label('Loader Id'),
  field_map: Joi.object({
    id: Joi.string().required(),
    first_name: Joi.string().required(),
    last_name: Joi.string().optional(),
    linkedin_url: Joi.string().optional(),
    owner: Joi.string().required(),
    job_position: Joi.string().optional(),
    company_name: Joi.string().optional(),
    emails: Joi.array()
      .items(
        Joi.object({
          type: Joi.string().required(),
          column_name: Joi.string().required(),
        }).optional()
      )
      .min(0)
      .required(),
    phone_numbers: Joi.array()
      .items(
        Joi.object({
          type: Joi.string().required(),
          column_name: Joi.string().required(),
        }).optional()
      )
      .min(0)
      .required(),
  }),
});

const importSellsyContactSchema = Joi.object({
  cadence_id: Joi.number().required(),
  contacts: Joi.array().required(),
  loaderId: Joi.string()
    .when('websocket', {
      is: true,
      then: Joi.required(),
      otherwise: Joi.optional(),
    })
    .label('Loader Id'),
  stopPreviousCadences: Joi.boolean().optional(),
  websocket: Joi.boolean().default(true).optional().label('Websocket'),
});

const fieldMapSchema = Joi.object({
  first_name: Joi.string().label('First Name').required(),
  last_name: Joi.string().label('Last Name').required(),
  linkedin_url: Joi.string().label('Linkedin URL').optional(),
  job_position: Joi.string().label('Job Position').optional(),
  company_name: Joi.string().label('Company Name').required(),
  company_phone_number: Joi.string().label('Company Phone Number').optional(),
  url: Joi.string().label('Company Website').optional(),
  country: Joi.string().label('Country').optional(),
  size: Joi.string().label('Size').optional(),
  zipcode: Joi.string().label('Zip code').optional(),
  emails: Joi.array()
    .items(
      Joi.object({
        type: Joi.string().label('email type').required(),
        column_name: Joi.string().label('column name').required(),
      })
    )
    .min(0)
    .required(),
  phone_numbers: Joi.array()
    .items(
      Joi.object({
        type: Joi.string().label('phone type').required(),
        column_name: Joi.string().label('column name').required(),
      })
    )
    .min(0)
    .required(),
  sellsy_owner_id: Joi.string().label('Sellsy Owner ID').required(),
});

const previewLeadsViaCSVSchema = Joi.object({
  field_map: fieldMapSchema.label('csv field map').required(),
  loaderId: Joi.string().label('loader id').optional(),
});

const previewLeadsViaSheetsSchema = Joi.object({
  url: Joi.string().uri().label('google sheet url').required(),
  field_map: fieldMapSchema.label('sheets field map').required(),
  loaderId: Joi.string().label('loader id').optional(),
});

const cadenceSchema = {
  fetchSheetsColumnsSchema,
  contactListSchema,
  csvImportSchema,
  importSellsyContactSchema,
  previewLeadsViaCSVSchema,
  previewLeadsViaSheetsSchema,
};

module.exports = cadenceSchema;
