// Utils
const {
  SALESFORCE_SOBJECTS,
  PIPEDRIVE_ENDPOINTS,
  HUBSPOT_ENDPOINTS,
  SELLSY_ENDPOINTS,
  FORM_FIELDS_FOR_CUSTOM_OBJECTS,
  ZOHO_ENDPOINTS,
  BULLHORN_ENDPOINTS,
  DYNAMICS_ENDPOINTS,
  DEFAULT_INTEGRATION_STATUS,
  DEFAULT_BULLHORN_INTEGRATION_STATUS,
} = require('../../../../../Cadence-Brain/src/utils/enums');

// Packages
const Joi = require('joi');

// * Create single salesforce field map
const salesforceCreateFieldMapSchema = Joi.object({
  sobject_type: Joi.string()
    .valid(...Object.values(SALESFORCE_SOBJECTS))
    .required(),

  sobject_values: Joi.alternatives()
    .conditional('sobject_type', {
      switch: [
        {
          is: SALESFORCE_SOBJECTS.LEAD, // * For salesforce lead
          then: Joi.object({
            first_name: Joi.string().required(), // FirstName
            last_name: Joi.string().required(), // LastName
            linkedin_url: Joi.string().allow('').optional(), // Linkedin__c
            source_site: Joi.string().allow('').optional(), // Source_site__c
            job_position: Joi.string().allow('').optional(), // Title
            company: Joi.string().allow('').optional(),
            size: Joi.alternatives()
              .try(
                Joi.string().allow('').required(),
                Joi.object({
                  name: Joi.string().required(),
                  picklist_values: Joi.array()
                    .items(
                      Joi.object({
                        label: Joi.string().required(),
                        value: Joi.string().required(),
                      })
                    )
                    .required(),
                }).required()
              )
              .optional(),
            url: Joi.string().allow('').optional(),
            country: Joi.string().allow('').optional(),
            zip_code: Joi.string().allow('').optional(),
            phone_numbers: Joi.array().items(Joi.string()).max(5).required(), // Phone, MobilePhone
            emails: Joi.array().items(Joi.string()).max(5).required(), // Emails
            integration_status: Joi.object({
              name: Joi.string().required(),
              picklist_values: Joi.array()
                .items(
                  Joi.object({
                    label: Joi.string().required(),
                    value: Joi.string().required(),
                  })
                )
                .required(),
              converted: Joi.object({
                label: Joi.string().required(),
                value: Joi.string().required(),
              }).optional(),
              disqualified: Joi.object({
                label: Joi.string().required(),
                value: Joi.string().required(),
              }).optional(),
            }).optional(),
            disqualification_reason: Joi.object({
              name: Joi.string().required(),
              picklist_values: Joi.array()
                .items(
                  Joi.object({
                    label: Joi.string().required(),
                    value: Joi.string().required(),
                  })
                )
                .required(),
            }).optional(),
            zoom_info: Joi.string().allow('').optional(),
          }).required(),
        },
        {
          is: SALESFORCE_SOBJECTS.CONTACT, // * For salesforce contact
          then: Joi.object({
            first_name: Joi.string().required(), // FirstName
            last_name: Joi.string().required(), // LastName
            linkedin_url: Joi.string().allow('').optional(), // URL_Profil_Linkedin__c
            source_site: Joi.string().allow('').optional(), // Source_site__c
            job_position: Joi.string().allow('').optional(), // Title
            phone_numbers: Joi.array().items(Joi.string()).max(5).required(), // Phone, MobilePhone, OtherPhone, HomePhone, AssistantPhone
            emails: Joi.array().items(Joi.string()).max(5).required(), // Email
            zoom_info: Joi.string().allow('').optional(),
          }).required(),
        },
        {
          is: SALESFORCE_SOBJECTS.ACCOUNT,
          then: Joi.object({
            name: Joi.string().required(), // Name
            size: Joi.alternatives()
              .try(
                Joi.string().allow('').required(),
                Joi.object({
                  name: Joi.string().required(),
                  picklist_values: Joi.array()
                    .items(
                      Joi.object({
                        label: Joi.string().required(),
                        value: Joi.string().required(),
                      })
                    )
                    .required(),
                }).required()
              )
              .optional(), // Effectif__c
            url: Joi.string().allow('').optional(), // Website
            country: Joi.string().allow('').optional(), // BillingCountry
            zip_code: Joi.string().allow('').optional(), // BillingPostalCode
            linkedin_url: Joi.string().allow('').optional(), // Linkedin_Societe__c
            phone_number: Joi.string().allow('').optional(), // Phone,
            integration_status: Joi.object({
              name: Joi.string().required(),
              picklist_values: Joi.array()
                .items(
                  Joi.object({
                    label: Joi.string().required(),
                    value: Joi.string().required(),
                  })
                )
                .required(),
              converted: Joi.object({
                label: Joi.string().required(),
                value: Joi.string().required(),
              }).optional(),
              disqualified: Joi.object({
                label: Joi.string().required(),
                value: Joi.string().required(),
              }).optional(),
            }).optional(),
            disqualification_reason: Joi.object({
              name: Joi.string().required(),
              picklist_values: Joi.array()
                .items(
                  Joi.object({
                    label: Joi.string().required(),
                    value: Joi.string().required(),
                  })
                )
                .required(),
            }).optional(),
          }).required(),
        },
        {
          is: SALESFORCE_SOBJECTS.OPPORTUNITY, // * For salesforce opportunity
          then: Joi.object({
            name: Joi.string().required(),
            close_date: Joi.string().required(),
            amount: Joi.string().allow('').required(),
            account: Joi.string().allow('').required(),
            // currency: Joi.string().allow('').optional(),
            contact: Joi.string().allow('').optional(), // Opportunity contact
            integration_owner_id: Joi.string().allow('').optional(),
            probability: Joi.string().allow('').optional(),
            integration_stage: Joi.object({
              name: Joi.string().required(),
              picklist_values: Joi.array()
                .items(
                  Joi.object({
                    label: Joi.string().required(),
                    value: Joi.string().required(),
                  })
                )
                .required(),
              won: Joi.object({
                label: Joi.string().required(),
                value: Joi.string().required(),
              }).optional(),
              lost: Joi.object({
                label: Joi.string().required(),
                value: Joi.string().required(),
              }).optional(),
            }).optional(), // Pipeline status
          }).optional(),
        },
      ],
    })
    .required(),
});

// * Describe a salesforce object
const describeSalesforceObjectSchema = Joi.object({
  object: Joi.string()
    .valid(...Object.values(SALESFORCE_SOBJECTS))
    .required(),
});

// * Test salesforce field map with a lead/contact
const testSalesforceFieldMap = Joi.object({
  salesforce_id: Joi.string().required(),
  type: Joi.string()
    .valid(...Object.values(SALESFORCE_SOBJECTS))
    .required(),
  salesforce_contact_map: Joi.object(),
  salesforce_account_map: Joi.object(),
  salesforce_lead_map: Joi.object(),
});

// * Create all salesforce field maps
const salesforceAllFieldMapSchema = Joi.object({
  default_integration_status: Joi.string()
    .valid(...Object.values(DEFAULT_INTEGRATION_STATUS))
    .required()
    .label('Default Integration Status'),
  contact_map: Joi.object({
    first_name: Joi.string().required().label('Contact first name'), // FirstName
    last_name: Joi.string().allow('').optional(), // LastName
    linkedin_url: Joi.string().allow('').optional(), // URL_Profil_Linkedin__c
    source_site: Joi.string().allow('').optional(), // Source_site__c
    job_position: Joi.string().allow('').optional(), // Title
    variables: Joi.array()
      .items(
        Joi.object({
          variable_field_name: Joi.string().required(),
          target_value: Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
            picklist_values: Joi.array().allow(null),
          }).required(),
        })
      )
      .min(0)
      .max(6)
      .required(), //Custom variable mapping
    phone_numbers: Joi.array().items(Joi.string()).max(5).required(), // Phone, MobilePhone, OtherPhone, HomePhone, AssistantPhone
    emails: Joi.array().items(Joi.string()).max(5).required(), // Email
    zoom_info: Joi.string().allow('').optional(),
    integration_status: Joi.object({
      name: Joi.string().required(),
      picklist_values: Joi.array()
        .items(
          Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          })
        )
        .required(),
      converted: Joi.object({
        label: Joi.string().required(),
        value: Joi.string().required(),
      }).optional(),
      disqualified: Joi.object({
        label: Joi.string().required(),
        value: Joi.string().required(),
      }).optional(),
      custom_actions: Joi.array().items(
        Joi.object({
          label: Joi.string().required(),
          value: Joi.string().required(),
          reasons: Joi.array()
            .items(
              Joi.object({
                label: Joi.string().required(),
                value: Joi.string().required(),
              })
            )
            .optional(),
        })
      ),
    }).optional(),
    disqualification_reason: Joi.object({
      name: Joi.string().required(),
      picklist_values: Joi.array()
        .items(
          Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          })
        )
        .required(),
    }).optional(),
  }).required(),

  lead_map: Joi.object({
    first_name: Joi.string().required(), // FirstName
    last_name: Joi.string().allow('').optional(), // LastName
    linkedin_url: Joi.string().allow('').optional(), // Linkedin__c
    source_site: Joi.string().allow('').optional(), // Source_site__c
    job_position: Joi.string().allow('').optional(), // Title
    variables: Joi.array()
      .items(
        Joi.object({
          variable_field_name: Joi.string().required(),
          target_value: Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
            picklist_values: Joi.array().allow(null),
          }).required(),
        })
      )
      .min(0)
      .max(6)
      .required(), //Custom variable mapping
    company: Joi.string().allow('').optional(),
    size: Joi.alternatives()
      .try(
        Joi.string().allow('').required(),
        Joi.object({
          name: Joi.string().required(),
          picklist_values: Joi.array()
            .items(
              Joi.object({
                label: Joi.string().required(),
                value: Joi.string().required(),
              })
            )
            .required(),
        }).required()
      )
      .optional(),
    url: Joi.string().allow('').optional(),
    country: Joi.string().allow('').optional(),
    zip_code: Joi.string().allow('').optional(),
    phone_numbers: Joi.array().items(Joi.string()).max(5).required(), // Phone, MobilePhone
    company_phone_number: Joi.string().allow('').optional(),
    emails: Joi.array().items(Joi.string()).max(5).required(), // Emails
    integration_status: Joi.object({
      name: Joi.string().required(),
      picklist_values: Joi.array()
        .items(
          Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          })
        )
        .required(),
      converted: Joi.object({
        label: Joi.string().required(),
        value: Joi.string().required(),
      }).optional(),
      disqualified: Joi.object({
        label: Joi.string().required(),
        value: Joi.string().required(),
      }).optional(),
      custom_actions: Joi.array().items(
        Joi.object({
          label: Joi.string().required(),
          value: Joi.string().required(),
          reasons: Joi.array()
            .items(
              Joi.object({
                label: Joi.string().required(),
                value: Joi.string().required(),
              })
            )
            .optional(),
        })
      ),
    }).optional(),
    disqualification_reason: Joi.object({
      name: Joi.string().required(),
      picklist_values: Joi.array()
        .items(
          Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          })
        )
        .required(),
    }).optional(),
    zoom_info: Joi.string().allow('').optional(),
  }).required(),

  account_map: Joi.object({
    name: Joi.string().required(), // Name
    size: Joi.alternatives()
      .try(
        Joi.string().allow('').required(),
        Joi.object({
          name: Joi.string().required(),
          picklist_values: Joi.array()
            .items(
              Joi.object({
                label: Joi.string().required(),
                value: Joi.string().required(),
              })
            )
            .required(),
        }).required()
      )
      .optional(), // Effectif__c
    url: Joi.string().allow('').optional(), // Website
    country: Joi.string().allow('').optional(), // BillingCountry
    zip_code: Joi.string().allow('').optional(), // BillingPostalCode
    linkedin_url: Joi.string().allow('').optional(), // Linkedin_Societe__c
    phone_number: Joi.string().allow('').optional(), // Phone,
    variables: Joi.array()
      .items(
        Joi.object({
          variable_field_name: Joi.string().required(),
          target_value: Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
            picklist_values: Joi.array().allow(null),
          }).required(),
        })
      )
      .min(0)
      .max(6)
      .required(), //Custom variable mapping
    integration_status: Joi.object({
      name: Joi.string().required(),
      picklist_values: Joi.array()
        .items(
          Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          })
        )
        .required(),
      converted: Joi.object({
        label: Joi.string().required(),
        value: Joi.string().required(),
      }).optional(),
      disqualified: Joi.object({
        label: Joi.string().required(),
        value: Joi.string().required(),
      }).optional(),
      custom_actions: Joi.array().items(
        Joi.object({
          label: Joi.string().required(),
          value: Joi.string().required(),
          reasons: Joi.array()
            .items(
              Joi.object({
                label: Joi.string().required(),
                value: Joi.string().required(),
              })
            )
            .optional(),
        })
      ),
    }).optional(),
    disqualification_reason: Joi.object({
      name: Joi.string().required(),
      picklist_values: Joi.array()
        .items(
          Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          })
        )
        .required(),
    }).optional(),
  }).required(),

  opportunity_map: Joi.object({
    name: Joi.string().required(),
    close_date: Joi.string().required(),
    amount: Joi.string().allow('').required(),
    // currency: Joi.string().allow('').required(),
    account: Joi.string().allow('').optional(),
    contact: Joi.string().allow('').optional(), // Contact person
    probability: Joi.string().allow('').optional(),
    integration_owner_id: Joi.string().allow('').optional(),
    integration_stage: Joi.object({
      name: Joi.string().required(),
      picklist_values: Joi.array()
        .items(
          Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          })
        )
        .required(),
      won: Joi.object({
        label: Joi.string().required(),
        value: Joi.string().required(),
      }).optional(),
      lost: Joi.object({
        label: Joi.string().required(),
        value: Joi.string().required(),
      }).optional(),
    }).optional(),
  }).optional(),
});

// * Create all salesforce field maps
const salesforceAllExtensionFieldMapSchema = Joi.object({
  contact_map: Joi.object({
    first_name: Joi.string().required().label('Contact first name'), // FirstName
    last_name: Joi.string().allow('').optional(), // LastName
    linkedin_url: Joi.string().allow('').optional(), // URL_Profil_Linkedin__c
    source_site: Joi.string().allow('').optional(), // Source_site__c
    job_position: Joi.string().allow('').optional(), // Title
    variables: Joi.array()
      .items(
        Joi.object({
          variable_field_name: Joi.string().required(),
          target_value: Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
            picklist_values: Joi.array().allow(null),
          }).required(),
        })
      )
      .min(0)
      .max(6)
      .required(), //Custom variable mapping
    phone_numbers: Joi.array().items(Joi.string()).max(5).required(), // Phone, MobilePhone, OtherPhone, HomePhone, AssistantPhone
    emails: Joi.array().items(Joi.string()).max(5).required(), // Email
    zoom_info: Joi.string().allow('').optional(),
    integration_status: Joi.object({
      name: Joi.string().required(),
      picklist_values: Joi.array()
        .items(
          Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          })
        )
        .required(),
      converted: Joi.object({
        label: Joi.string().required(),
        value: Joi.string().required(),
      }).optional(),
      disqualified: Joi.object({
        label: Joi.string().required(),
        value: Joi.string().required(),
      }).optional(),
      custom_actions: Joi.array().items(
        Joi.object({
          label: Joi.string().required(),
          value: Joi.string().required(),
          reasons: Joi.array()
            .items(
              Joi.object({
                label: Joi.string().required(),
                value: Joi.string().required(),
              })
            )
            .optional(),
        })
      ),
    }).optional(),
    disqualification_reason: Joi.object({
      name: Joi.string().required(),
      picklist_values: Joi.array()
        .items(
          Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          })
        )
        .required(),
    }).optional(),
  }).required(),

  lead_map: Joi.object({
    first_name: Joi.string().required(), // FirstName
    last_name: Joi.string().allow('').optional(), // LastName
    linkedin_url: Joi.string().allow('').optional(), // Linkedin__c
    source_site: Joi.string().allow('').optional(), // Source_site__c
    job_position: Joi.string().allow('').optional(), // Title
    variables: Joi.array()
      .items(
        Joi.object({
          variable_field_name: Joi.string().required(),
          target_value: Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
            picklist_values: Joi.array().allow(null),
          }).required(),
        })
      )
      .min(0)
      .max(6)
      .required(), //Custom variable mapping
    company: Joi.string().allow('').optional(),
    size: Joi.alternatives()
      .try(
        Joi.string().allow('').required(),
        Joi.object({
          name: Joi.string().required(),
          picklist_values: Joi.array()
            .items(
              Joi.object({
                label: Joi.string().required(),
                value: Joi.string().required(),
              })
            )
            .required(),
        }).required()
      )
      .optional(),
    url: Joi.string().allow('').optional(),
    country: Joi.string().allow('').optional(),
    zip_code: Joi.string().allow('').optional(),
    phone_numbers: Joi.array().items(Joi.string()).max(5).required(), // Phone, MobilePhone
    company_phone_number: Joi.string().allow('').optional(),
    emails: Joi.array().items(Joi.string()).max(5).required(), // Emails
    integration_status: Joi.object({
      name: Joi.string().required(),
      picklist_values: Joi.array()
        .items(
          Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          })
        )
        .required(),
      converted: Joi.object({
        label: Joi.string().required(),
        value: Joi.string().required(),
      }).optional(),
      disqualified: Joi.object({
        label: Joi.string().required(),
        value: Joi.string().required(),
      }).optional(),
      custom_actions: Joi.array().items(
        Joi.object({
          label: Joi.string().required(),
          value: Joi.string().required(),
          reasons: Joi.array()
            .items(
              Joi.object({
                label: Joi.string().required(),
                value: Joi.string().required(),
              })
            )
            .optional(),
        })
      ),
    }).optional(),
    disqualification_reason: Joi.object({
      name: Joi.string().required(),
      picklist_values: Joi.array()
        .items(
          Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          })
        )
        .required(),
    }).optional(),
    zoom_info: Joi.string().allow('').optional(),
  }).required(),

  account_map: Joi.object({
    name: Joi.string().required(), // Name
    size: Joi.alternatives()
      .try(
        Joi.string().allow('').required(),
        Joi.object({
          name: Joi.string().required(),
          picklist_values: Joi.array()
            .items(
              Joi.object({
                label: Joi.string().required(),
                value: Joi.string().required(),
              })
            )
            .required(),
        }).required()
      )
      .optional(), // Effectif__c
    url: Joi.string().allow('').optional(), // Website
    country: Joi.string().allow('').optional(), // BillingCountry
    zip_code: Joi.string().allow('').optional(), // BillingPostalCode
    linkedin_url: Joi.string().allow('').optional(), // Linkedin_Societe__c
    phone_number: Joi.string().allow('').optional(), // Phone,
    variables: Joi.array()
      .items(
        Joi.object({
          variable_field_name: Joi.string().required(),
          target_value: Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
            picklist_values: Joi.array().allow(null),
          }).required(),
        })
      )
      .min(0)
      .max(6)
      .required(), //Custom variable mapping
    integration_status: Joi.object({
      name: Joi.string().required(),
      picklist_values: Joi.array()
        .items(
          Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          })
        )
        .required(),
      converted: Joi.object({
        label: Joi.string().required(),
        value: Joi.string().required(),
      }).optional(),
      disqualified: Joi.object({
        label: Joi.string().required(),
        value: Joi.string().required(),
      }).optional(),
      custom_actions: Joi.array().items(
        Joi.object({
          label: Joi.string().required(),
          value: Joi.string().required(),
          reasons: Joi.array()
            .items(
              Joi.object({
                label: Joi.string().required(),
                value: Joi.string().required(),
              })
            )
            .optional(),
        })
      ),
    }).optional(),
    disqualification_reason: Joi.object({
      name: Joi.string().required(),
      picklist_values: Joi.array()
        .items(
          Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          })
        )
        .required(),
    }).optional(),
  }).required(),

  opportunity_map: Joi.object({
    name: Joi.string().required(),
    close_date: Joi.string().required(),
    amount: Joi.string().allow('').required(),
    // currency: Joi.string().allow('').required(),
    account: Joi.string().allow('').optional(),
    contact: Joi.string().allow('').optional(), // Contact person
    probability: Joi.string().allow('').optional(),
    integration_owner_id: Joi.string().allow('').optional(),
    integration_stage: Joi.object({
      name: Joi.string().required(),
      picklist_values: Joi.array()
        .items(
          Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          })
        )
        .required(),
      won: Joi.object({
        label: Joi.string().required(),
        value: Joi.string().required(),
      }).optional(),
      lost: Joi.object({
        label: Joi.string().required(),
        value: Joi.string().required(),
      }).optional(),
    }).optional(),
  }).optional(),
});

// * Create single salesforce field map
const createSalesforceCustomObject = Joi.object({
  object_type: Joi.string()
    .valid(...Object.values(SALESFORCE_SOBJECTS))
    .required(),
  custom_object: Joi.array()
    .items({
      button_text: Joi.string().required(),
      form: Joi.array()
        .items({
          type: Joi.string()
            .valid(...Object.values(FORM_FIELDS_FOR_CUSTOM_OBJECTS))
            .required(), //<enum> // INPUT_BOX , DROPDOWN, RADIO_BUTTON
          position: {
            row: Joi.number().required(), // <integer> ,
            column: Joi.number().required(), // <integer>
          },
          editable: Joi.bool().required(),
          input_type: Joi.string().optional(),
          salesforce_field: Joi.string().required(), // <string> // This would be the salesforce field,
          salesforce_label: Joi.string().required(),
          sobject: Joi.string()
            .valid(...Object.values(SALESFORCE_SOBJECTS))
            .required(), // "contact" , "lead" , "account"
          possible_values: Joi.array().optional(), //<array> (OPTIONAL)
          reference_to: Joi.string().optional(),
        })
        .required(),
    })
    .max(1)
    .required(),
});

// * Test salesforce custom object
const testSalesforceCustomObject = Joi.object({
  type: Joi.string()
    .required()
    .valid(...Object.values(SALESFORCE_SOBJECTS)),
  id: Joi.string().required(),
  custom_object: Joi.object().required(),
  custom_object_account: Joi.object().optional(),
  salesforce_account_id: Joi.string().optional(),
});

// * Pipedrive schema validations

// * Create single pipedrive field map
const pipedriveCreateFieldMapSchema = Joi.object({
  endpoint_type: Joi.string()
    .valid(...Object.values(PIPEDRIVE_ENDPOINTS))
    .required(),

  endpoint_values: Joi.alternatives()
    .conditional('endpoint_type', {
      switch: [
        {
          is: PIPEDRIVE_ENDPOINTS.PERSON, // * For pipedrive person
          then: Joi.object({
            first_name: Joi.string().required(), // First Name
            last_name: Joi.string().required(), // Last name
            linkedin_url: Joi.string().allow('').optional(), // Linkedin__c
            job_position: Joi.string().allow('').optional(), // Title
            phone_numbers: Joi.string().valid('phone').required(), // Phone
            emails: Joi.string().valid('email').required(), // Email
          }).required(),
        },
        {
          is: PIPEDRIVE_ENDPOINTS.ORGANIZATION,
          then: Joi.object({
            name: Joi.string().required(), // Name
            size: Joi.object({
              name: Joi.string().required(),
              picklist_values: Joi.array()
                .items(
                  Joi.object({
                    label: Joi.string().required(),
                    value: Joi.string().required(),
                  })
                )
                .required(),
            }).optional(), // Effectif__c
            url: Joi.string().allow('').optional(), // Website
            country: Joi.string().allow('').optional(), // BillingCountry
            zip_code: Joi.string().allow('').optional(), // BillingPostalCode
            linkedin_url: Joi.string().allow('').optional(), // Linkedin_Societe__c
            phone_number: Joi.string().allow('').optional(), // Phone,
          }).required(),
        },
        {
          is: PIPEDRIVE_ENDPOINTS.DEAL, // * For pipedrive deal
          then: Joi.object({
            name: Joi.string().required(),
            close_date: Joi.string().required(),
            amount: Joi.string().allow('').required(),
            currency: Joi.string().allow('').required(),
            account: Joi.string().allow('').optional(),
            contact: Joi.string().allow('').optional(), // Contact person
            probability: Joi.string().allow('').optional(),
            integration_owner_id: Joi.string().allow('').optional(),
            integration_stage: Joi.object({
              name: Joi.string().required(),
              picklist_values: Joi.array()
                .items(
                  Joi.object({
                    label: Joi.string().required(),
                    value: Joi.string().required(),
                  })
                )
                .required(),
              won: Joi.object({
                label: Joi.string().required(),
                value: Joi.string().required(),
              }).optional(),
              lost: Joi.object({
                label: Joi.string().required(),
                value: Joi.string().required(),
              }).optional(),
            }).optional(),
          }).optional(),
        },
      ],
    })
    .required(),
});

// * Describe pipedrive endpoint
const describePipedriveEndpointSchema = Joi.object({
  object: Joi.string()
    .valid(...Object.values(PIPEDRIVE_ENDPOINTS))
    .required(),
});

// * Create pipedrive all field map
const pipedriveAllCreateFieldMapSchema = Joi.object({
  person_map: Joi.object({
    first_name: Joi.string().required().label('First Name'), // First Name
    last_name: Joi.string().required().label('Last Name'), // Last name
    linkedin_url: Joi.string().allow('').optional().label('Linkedin'), // Linkedin__c
    job_position: Joi.string().allow('').optional().label('Title'), // Title
    phone_numbers: Joi.string().valid('phone').required().label('Phone'), // Phone
    emails: Joi.string().valid('email').required().label('Email'), // Email
    variables: Joi.array()
      .items(
        Joi.object({
          variable_field_name: Joi.string().required(),
          target_value: Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          }).required(),
        })
      )
      .min(0)
      .max(4)
      .optional()
      .label('Custom Variables'), //Custom variable mapping
  }).required(),
  organization_map: Joi.object({
    name: Joi.string().required().label('Company Name'), // Name
    size: Joi.object({
      name: Joi.string().required(),
      picklist_values: Joi.array()
        .items(
          Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          })
        )
        .required(),
    })
      .optional()
      .label('Size'), // Effectif__c
    url: Joi.string().allow('').optional().label('Company URL'), // Website
    country: Joi.string().allow('').optional().label('Country'), // BillingCountry
    zip_code: Joi.string().allow('').optional().label('Zipcode'), // BillingPostalCode
    linkedin_url: Joi.string()
      .allow('')
      .optional()
      .label('Company Linkedin URL'), // Linkedin_Societe__c
    phone_number: Joi.string()
      .allow('')
      .optional()
      .label('Company phone number'), // Phone,
    variables: Joi.array()
      .items(
        Joi.object({
          variable_field_name: Joi.string().required(),
          target_value: Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          }).required(),
        })
      )
      .min(0)
      .max(4)
      .optional()
      .label('Custom Variables'), //Custom variable mapping
  }),
  deal_map: Joi.object({
    name: Joi.string().required(),
    close_date: Joi.string().required(),
    amount: Joi.string().allow('').required(),
    currency: Joi.string().allow('').required(),
    account: Joi.string().allow('').optional(),
    contact: Joi.string().allow('').optional(), // Opportunity contact
    integration_owner_id: Joi.string().allow('').optional(),
    probability: Joi.string().allow('').optional(),
    integration_stage: Joi.object({
      name: Joi.string().required(),
      picklist_values: Joi.array()
        .items(
          Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          })
        )
        .required(),
      won: Joi.object({
        label: Joi.string().required(),
        value: Joi.string().required(),
      }).optional(),
      lost: Joi.object({
        label: Joi.string().required(),
        value: Joi.string().required(),
      }).optional(),
    }).optional(),
  }).optional(),
});

// * Test pipedrive field map with a lead/contact
const testPipedriveFieldMap = Joi.object({
  person_id: Joi.string().required(),
  person_map: Joi.object().required(),
  organization_map: Joi.object().required(),
});

// * Create single salesforce field map
const createPipedriveCustomObject = Joi.object({
  object_type: Joi.string()
    .valid(PIPEDRIVE_ENDPOINTS.PERSON, PIPEDRIVE_ENDPOINTS.DEAL)
    .required(),
  custom_object: Joi.array()
    .items({
      button_text: Joi.string().required(),
      form: Joi.array()
        .items({
          type: Joi.string()
            .valid(...Object.values(FORM_FIELDS_FOR_CUSTOM_OBJECTS))
            .required(), //<enum> // INPUT_BOX , DROPDOWN, RADIO_BUTTON
          position: {
            row: Joi.number().required(), // <integer> ,
            column: Joi.number().required(), // <integer>
          },
          editable: Joi.bool().required(),
          input_type: Joi.string().optional(),
          pipedrive_field: Joi.string().required(), // <string> // This would be the salesforce field,
          pipedrive_label: Joi.string().required(),
          pipedrive_endpoint: Joi.string()
            .valid(...Object.values(PIPEDRIVE_ENDPOINTS))
            .required(), // "person" , "organisation"
          possible_values: Joi.array().optional(), //<array> (OPTIONAL)
          reference_to: Joi.string().optional(),
        })
        .required(),
    })
    .max(1)
    .required(),
});

// * Test salesforce custom object
const testPipedriveCustomObject = Joi.object({
  person_id: Joi.string().optional(),
  person_object: Joi.object().optional(),
  organization_id: Joi.string().optional(),
  organization_object: Joi.object().optional(),
});

// * Create single hubspot field map
const hubspotCreateFieldMapSchema = Joi.object({
  endpoint_type: Joi.string()
    .valid(...Object.values(HUBSPOT_ENDPOINTS))
    .required(),
  endpoint_values: Joi.alternatives()
    .conditional('endpoint_type', {
      switch: [
        {
          is: HUBSPOT_ENDPOINTS.CONTACT, // * For hubspot contact
          then: Joi.object({
            first_name: Joi.string().required(), // firstname
            last_name: Joi.string().required(), // lastname
            linkedin_url: Joi.string().allow('').optional(), // hs_linkedinid
            job_position: Joi.string().allow('').optional(), // jobtitle
            phone_numbers: Joi.array().items(Joi.string()).max(5).required(), // phone_number, hs_whatsapp_phone_number
            emails: Joi.array().items(Joi.string()).max(5).required(), // email, work_email
          }).required(),
        },
        {
          is: HUBSPOT_ENDPOINTS.COMPANY,
          then: Joi.object({
            name: Joi.string().required(), // name
            size: Joi.string().allow('').optional(), // numberofemployees
            url: Joi.string().allow('').optional(), // website
            country: Joi.string().allow('').optional(), // country
            zip_code: Joi.string().allow('').optional(), // zip
            linkedin_url: Joi.string().allow('').optional(), // linkedin_company_page
            phone_number: Joi.string().allow('').optional(), // phone
          }).required(),
        },
      ],
    })
    .required(),
});

// * Create all hubspot field maps
const hubspotAllFieldMapSchema = Joi.object({
  contact_map: Joi.object({
    first_name: Joi.string().required(), // firstname
    last_name: Joi.string().allow('').optional(), // lastname
    linkedin_url: Joi.string().allow('').optional(), // hs_linkedinid
    job_position: Joi.string().allow('').optional(), // jobtitle
    phone_numbers: Joi.array().items(Joi.string()).max(5).required(), // phone_number, hs_whatsapp_phone_number
    emails: Joi.array().items(Joi.string()).max(5).required(), // email, work_email
    integration_status: Joi.object({
      name: Joi.string().required(),
      picklist_values: Joi.array()
        .items(
          Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          })
        )
        .required(),
      converted: Joi.object({
        label: Joi.string().required(),
        value: Joi.string().required(),
      }).optional(),
      disqualified: Joi.object({
        label: Joi.string().required(),
        value: Joi.string().required(),
      }).optional(),
    }).optional(),
    disqualification_reason: Joi.object({
      name: Joi.string().required(),
      picklist_values: Joi.array()
        .items(
          Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          })
        )
        .required(),
    }).optional(),
    variables: Joi.array()
      .items(
        Joi.object({
          variable_field_name: Joi.string().required(),
          target_value: Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          }).required(),
        })
      )
      .min(0)
      .max(4)
      .optional()
      .label('Custom Variables'), //Custom variable mapping
  }).required(),
  company_map: Joi.object({
    name: Joi.string().required(), // name
    size: Joi.alternatives()
      .try(
        Joi.string().allow('').required(),
        Joi.object({
          name: Joi.string().required(),
          picklist_values: Joi.array()
            .items(
              Joi.object({
                label: Joi.string().required(),
                value: Joi.string().required(),
              })
            )
            .required(),
        }).required()
      )
      .optional(), // numberofemployees
    url: Joi.string().allow('').optional(), // website
    country: Joi.string().allow('').optional(), // country
    zip_code: Joi.string().allow('').optional(), // zip
    linkedin_url: Joi.string().allow('').optional(), // linkedin_company_page
    phone_number: Joi.string().allow('').optional(), // phone
    variables: Joi.array()
      .items(
        Joi.object({
          variable_field_name: Joi.string().required(),
          target_value: Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          }).required(),
        })
      )
      .min(0)
      .max(4)
      .optional()
      .label('Custom Variables'), //Custom variable mapping
  }).required(),
});

// * Describe pipedrive endpoint
const describeHubspotEndpointSchema = Joi.object({
  object: Joi.string()
    .valid(...Object.values(HUBSPOT_ENDPOINTS))
    .required(),
});

// * Test salesforce field map with a lead/contact
const testHubspotFieldMap = Joi.object({
  hsfm_id: Joi.string().required(),
  type: Joi.string()
    .valid(...Object.values(HUBSPOT_ENDPOINTS))
    .required(),
  hubspot_contact_map: Joi.object(),
  hubspot_company_map: Joi.object(),
});

const createHubspotCustomObject = Joi.object({
  object_type: Joi.string().valid(HUBSPOT_ENDPOINTS.CONTACT).required(),
  custom_object: Joi.array()
    .items({
      button_text: Joi.string().required(),
      form: Joi.array()
        .items({
          type: Joi.string()
            .valid(...Object.values(FORM_FIELDS_FOR_CUSTOM_OBJECTS))
            .required(), //<enum> // INPUT_BOX , DROPDOWN, RADIO_BUTTON
          position: {
            row: Joi.number().required(), // <integer> ,
            column: Joi.number().required(), // <integer>
          },
          editable: Joi.bool().required(),
          input_type: Joi.string().optional(),
          hubspot_field: Joi.string().required(), // <string> // This would be the hubspot field,
          hubspot_label: Joi.string().required(),
          hubspot_endpoint: Joi.string()
            .valid(...Object.values(HUBSPOT_ENDPOINTS))
            .required(), // "contact" , "company"
          possible_values: Joi.array().optional(), //<array> (OPTIONAL)
          reference_to: Joi.string().optional(),
        })
        .required(),
    })
    .max(1)
    .required(),
});
const testHubspotCustomObject = Joi.object({
  contact_id: Joi.string().required(),
  custom_object: Joi.object().required(),
  custom_object_company: Joi.object().optional(),
  hubspot_company_id: Joi.string().optional(),
});
const testHubspotObject = Joi.object({
  contact_properties: Joi.string().required(),
  company_properties: Joi.string().required(),
});

// * Create single sellsy field map
const sellsyCreateFieldMapSchema = Joi.object({
  endpoint_type: Joi.string()
    .valid(...Object.values(SELLSY_ENDPOINTS))
    .required(),
  endpoint_values: Joi.alternatives()
    .conditional('endpoint_type', {
      switch: [
        {
          is: SELLSY_ENDPOINTS.CONTACT, // * For hubspot contact
          then: Joi.object({
            first_name: Joi.string().required(), // firstname
            last_name: Joi.string().optional(), // lastname
            linkedin_url: Joi.string().allow('').optional(),
            job_position: Joi.string().allow('').optional(), // jobtitle
            phone_numbers: Joi.array().items(Joi.string()).max(5).required(), // phone_number, hs_whatsapp_phone_number
            emails: Joi.array().items(Joi.string()).max(5).required(), // email, work_email
          }).required(),
        },
        {
          is: SELLSY_ENDPOINTS.COMPANY,
          then: Joi.object({
            name: Joi.string().required(), // name
            size: Joi.string().allow('').optional(),
            url: Joi.string().allow('').optional(), // website
            phone_number: Joi.string().allow('').optional(), // Phone,
            country: Joi.string().allow('').optional(), // country
            zipcode: Joi.string().allow('').optional(), // zip
          }).required(),
        },
      ],
    })
    .required(),
});

// * Describe sellsy endpoint
const describeSellsyEndpointSchema = Joi.object({
  object: Joi.string()
    .valid(...Object.values(SELLSY_ENDPOINTS))
    .required(),
});

// * Create all sellsy field maps
const sellsyAllFieldMapSchema = Joi.object({
  contact_map: Joi.object({
    first_name: Joi.string().required(), // firstname
    last_name: Joi.string().optional(), // lastname
    linkedin_url: Joi.string().allow('').optional(),
    job_position: Joi.string().allow('').optional(), // jobtitle
    phone_numbers: Joi.array().items(Joi.string()).max(5).required(), // phone_number, hs_whatsapp_phone_number
    emails: Joi.array().items(Joi.string()).max(5).required(), // email, work_email
    variables: Joi.array()
      .items(
        Joi.object({
          variable_field_name: Joi.string().required(),
          target_value: Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
            picklist_values: Joi.array().allow(null),
          }).required(),
        })
      )
      .min(0)
      .max(4)
      .optional()
      .label('Custom Variables'), //Custom variable mapping
  }).required(),
  company_map: Joi.object({
    name: Joi.string().required(), // name
    size: Joi.string().allow('').optional(),
    url: Joi.string().allow('').optional(), // website
    phone_number: Joi.string().allow('').optional(), // Phone, // phone_number, hs_whatsapp_phone_number
    country: Joi.string().allow('').optional(), // country
    zipcode: Joi.string().allow('').optional(), // zip
    variables: Joi.array()
      .items(
        Joi.object({
          variable_field_name: Joi.string().required(),
          target_value: Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
            picklist_values: Joi.array().allow(null),
          }).required(),
        })
      )
      .min(0)
      .max(4)
      .optional()
      .label('Custom Variables'), //Custom variable mapping
  }).required(),
});

// * Test sellsy field map with a lead/contact
const testSellsyFieldMap = Joi.object({
  contact_id: Joi.string().required(),
  contact_map: Joi.object().required(),
  company_map: Joi.object().required(),
});

// * Create sellsy custom object
const createSellsyCustomObject = Joi.object({
  object_type: Joi.string().valid(SELLSY_ENDPOINTS.CONTACT).required(),
  custom_object: Joi.object({
    button_text: Joi.string().required(),
    form: Joi.array()
      .items({
        type: Joi.string()
          .valid(...Object.values(FORM_FIELDS_FOR_CUSTOM_OBJECTS))
          .required(), //<enum> // INPUT_BOX , DROPDOWN, RADIO_BUTTON
        position: {
          row: Joi.number().required(), // <integer> ,
          column: Joi.number().required(), // <integer>
        },
        editable: Joi.bool().required(),
        input_type: Joi.string().optional(),
        sellsy_field: Joi.string().required(), // <string> // This would be the sellsy field,
        sellsy_label: Joi.string().required(),
        sellsy_field_id: Joi.number().optional(),
        sellsy_mandatory: Joi.bool().optional(),
        sellsy_endpoint: Joi.string()
          .valid(...Object.values(SELLSY_ENDPOINTS))
          .required(), // "contact" , "company"
        possible_values: Joi.array().optional(), //<array> (OPTIONAL)
      })
      .required(),
  }).required(),
});

const testSellsyCustomObject = Joi.object({
  id: Joi.number().required(),
  contact_custom_object: Joi.object().required(),
  company_custom_object: Joi.object().optional(),
  sellsy_company_id: Joi.number().optional(),
});

const testSellsyObject = Joi.object({
  sellsy_contact_id: Joi.number().required(),
  contact_custom_object: Joi.array().required(),
});

const zohoCreateFieldMapSchema = Joi.object({
  zobject_type: Joi.string()
    .valid(...Object.values(ZOHO_ENDPOINTS))
    .required(),

  zobject_values: Joi.alternatives()
    .conditional('zobject_type', {
      switch: [
        {
          is: ZOHO_ENDPOINTS.LEAD, // * For salesforce lead
          then: Joi.object({
            first_name: Joi.string().required(), // FirstName
            last_name: Joi.string().required(), // LastName
            linkedin_url: Joi.string().allow('').optional(), // Linkedin__c
            source_site: Joi.string().allow('').optional(), // Source_site__c
            job_position: Joi.string().allow('').optional(), // Title
            company: Joi.string().allow('').optional(),
            size: Joi.alternatives()
              .try(
                Joi.string().allow('').required(),
                Joi.object({
                  name: Joi.string().required(),
                  picklist_values: Joi.array()
                    .items(
                      Joi.object({
                        label: Joi.string().required(),
                        value: Joi.string().required(),
                      })
                    )
                    .required(),
                }).required()
              )
              .optional(),
            url: Joi.string().allow('').optional(),
            country: Joi.string().allow('').optional(),
            zip_code: Joi.string().allow('').optional(),
            phone_numbers: Joi.array().items(Joi.string()).max(5).required(), // Phone, MobilePhone
            emails: Joi.array().items(Joi.string()).max(5).required(), // Emails
          }).required(),
        },
        {
          is: ZOHO_ENDPOINTS.CONTACT, // * For salesforce contact
          then: Joi.object({
            first_name: Joi.string().required(), // FirstName
            last_name: Joi.string().required(), // LastName
            linkedin_url: Joi.string().allow('').optional(), // URL_Profil_Linkedin__c
            source_site: Joi.string().allow('').optional(), // Source_site__c
            job_position: Joi.string().allow('').optional(), // Title
            phone_numbers: Joi.array().items(Joi.string()).max(5).required(), // Phone, MobilePhone, OtherPhone, HomePhone, AssistantPhone
            emails: Joi.array().items(Joi.string()).max(5).required(), // Email
          }).required(),
        },
        {
          is: ZOHO_ENDPOINTS.ACCOUNT,
          then: Joi.object({
            name: Joi.string().required(), // Name
            size: Joi.alternatives()
              .try(
                Joi.string().allow('').required(),
                Joi.object({
                  name: Joi.string().required(),
                  picklist_values: Joi.array()
                    .items(
                      Joi.object({
                        label: Joi.string().required(),
                        value: Joi.string().required(),
                      })
                    )
                    .required(),
                }).required()
              )
              .optional(), // Effectif__c
            url: Joi.string().allow('').optional(), // Website
            country: Joi.string().allow('').optional(), // BillingCountry
            zip_code: Joi.string().allow('').optional(), // BillingPostalCode
            linkedin_url: Joi.string().allow('').optional(), // Linkedin_Societe__c
            phone_number: Joi.string().allow('').optional(), // Phone,
          }).required(),
        },
      ],
    })
    .required(),
});
const describeZohoObjectSchema = Joi.object({
  object: Joi.string()
    .valid(...Object.values(ZOHO_ENDPOINTS))
    .required(),
});
const zohoAllFieldMapSchema = Joi.object({
  contact_map: Joi.object({
    first_name: Joi.string().required(), // FirstName
    last_name: Joi.string().allow('').optional(), // LastName
    linkedin_url: Joi.string().allow('').optional(), // URL_Profil_Linkedin__c
    source_site: Joi.string().allow('').optional(), // Source_site__c
    job_position: Joi.string().allow('').optional(), // Title
    phone_numbers: Joi.array().items(Joi.string()).max(5).required(), // Phone, MobilePhone, OtherPhone, HomePhone, AssistantPhone
    emails: Joi.array().items(Joi.string()).max(5).required(), // Email
    variables: Joi.array()
      .items(
        Joi.object({
          variable_field_name: Joi.string().required(),
          target_value: Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
            picklist_values: Joi.array().allow(null),
          }).required(),
        })
      )
      .min(0)
      .max(4)
      .optional()
      .label('Custom Variables'), //Custom variable mapping
  }).required(),

  lead_map: Joi.object({
    first_name: Joi.string().required(), // FirstName
    last_name: Joi.string().allow('').optional(), // LastName
    linkedin_url: Joi.string().allow('').optional(), // Linkedin__c
    source_site: Joi.string().allow('').optional(), // Source_site__c
    job_position: Joi.string().allow('').optional(), // Title
    company: Joi.string().allow('').optional(),
    size: Joi.alternatives()
      .try(
        Joi.string().allow('').required(),
        Joi.object({
          name: Joi.string().required(),
          picklist_values: Joi.array()
            .items(
              Joi.object({
                label: Joi.string().required(),
                value: Joi.string().required(),
              })
            )
            .required(),
        }).required()
      )
      .optional(),
    url: Joi.string().allow('').optional(),
    country: Joi.string().allow('').optional(),
    zip_code: Joi.string().allow('').optional(),
    phone_numbers: Joi.array().items(Joi.string()).max(5).required(), // Phone, MobilePhone
    emails: Joi.array().items(Joi.string()).max(5).required(), // Emails
    variables: Joi.array()
      .items(
        Joi.object({
          variable_field_name: Joi.string().required(),
          target_value: Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
            picklist_values: Joi.array().allow(null),
          }).required(),
        })
      )
      .min(0)
      .max(4)
      .optional()
      .label('Custom Variables'), //Custom variable mapping
  }).required(),

  account_map: Joi.object({
    name: Joi.string().required(), // Name
    size: Joi.alternatives()
      .try(
        Joi.string().allow('').required(),
        Joi.object({
          name: Joi.string().required(),
          picklist_values: Joi.array()
            .items(
              Joi.object({
                label: Joi.string().required(),
                value: Joi.string().required(),
              })
            )
            .required(),
        }).required()
      )
      .optional(), // Effectif__c
    url: Joi.string().allow('').optional(), // Website
    country: Joi.string().allow('').optional(), // BillingCountry
    zip_code: Joi.string().allow('').optional(), // BillingPostalCode
    linkedin_url: Joi.string().allow('').optional(), // Linkedin_Societe__c
    phone_number: Joi.string().allow('').optional(), // Phone,
    variables: Joi.array()
      .items(
        Joi.object({
          variable_field_name: Joi.string().required(),
          target_value: Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
            picklist_values: Joi.array().allow(null),
          }).required(),
        })
      )
      .min(0)
      .max(4)
      .optional()
      .label('Custom Variables'), //Custom variable mapping
  }).required(),
});
const testZohoFieldMap = Joi.object({
  zfm_id: Joi.string().required(),
  type: Joi.string()
    .valid(...Object.values(ZOHO_ENDPOINTS))
    .required(),
  zoho_contact_map: Joi.object(),
  zoho_account_map: Joi.object(),
  zoho_lead_map: Joi.object(),
});
const createZohoCustomObject = Joi.object({
  object_type: Joi.string()
    .valid(...Object.values(ZOHO_ENDPOINTS))
    .required(),
  custom_object: Joi.array()
    .items({
      button_text: Joi.string().required(),
      form: Joi.array()
        .items({
          type: Joi.string()
            .valid(...Object.values(FORM_FIELDS_FOR_CUSTOM_OBJECTS))
            .required(), //<enum> // INPUT_BOX , DROPDOWN, RADIO_BUTTON
          position: {
            row: Joi.number().required(), // <integer> ,
            column: Joi.number().required(), // <integer>
          },
          editable: Joi.bool().required(),
          input_type: Joi.string().optional(),
          zoho_field: Joi.string().required(), // <string> // This would be the zoho field,
          zoho_label: Joi.string().required(),
          zoho_endpoint: Joi.string()
            .valid(...Object.values(ZOHO_ENDPOINTS))
            .required(), // "contact" , "lead" , "account"
          possible_values: Joi.array().optional(), //<array> (OPTIONAL)
          reference_to: Joi.string().optional(),
        })
        .required(),
    })
    .max(1)
    .required(),
});
const testZohoCustomObject = Joi.object({
  type: Joi.string()
    .required()
    .valid(...Object.values(ZOHO_ENDPOINTS)),
  id: Joi.string().required(),
  custom_object: Joi.object().required(),
  custom_object_account: Joi.object().optional(),
  zoho_account_id: Joi.string().optional(),
});
const testZohoObject = Joi.object({
  type: Joi.string()
    .required()
    .valid(...Object.values(ZOHO_ENDPOINTS)),
  id: Joi.string().required(),
});

const describeBullhornObjectSchema = Joi.object({
  object: Joi.string()
    .valid(...Object.values(BULLHORN_ENDPOINTS))
    .required(),
});
const testBullhornFieldMap = Joi.object({
  bfm_id: Joi.string().required(),
  type: Joi.string()
    .valid(...Object.values(BULLHORN_ENDPOINTS))
    .required(),
  bullhorn_contact_map: Joi.object(),
  bullhorn_account_map: Joi.object(),
  bullhorn_lead_map: Joi.object(),
  bullhorn_candidate_map: Joi.object(),
});
const testBullhornObject = Joi.object({
  type: Joi.string()
    .required()
    .valid(...Object.values(BULLHORN_ENDPOINTS)),
  id: Joi.string().required(),
});
const bullhornAllFieldMapSchema = Joi.object({
  default_integration_status: Joi.object({
    lead: Joi.string()
      .valid(...Object.values(DEFAULT_BULLHORN_INTEGRATION_STATUS))
      .required()
      .label('Default Lead Integration Status'),
    contact: Joi.string()
      .valid(...Object.values(DEFAULT_BULLHORN_INTEGRATION_STATUS))
      .required()
      .label('Default contact Integration Status'),
  })
    .required()
    .label('Default Integration Status'),
  contact_map: Joi.object({
    first_name: Joi.string().required(), // FirstName
    last_name: Joi.string().allow('').optional(), // LastName
    linkedin_url: Joi.string().allow('').optional(), // URL_Profil_Linkedin__c
    source_site: Joi.string().allow('').optional(), // Source_site__c
    job_position: Joi.string().allow('').optional(), // Title
    phone_numbers: Joi.array().items(Joi.string()).max(5).required(), // Phone, MobilePhone, OtherPhone, HomePhone, AssistantPhone
    emails: Joi.array().items(Joi.string()).max(5).required(), // Email
    variables: Joi.array()
      .items(
        Joi.object({
          variable_field_name: Joi.string().required(),
          target_value: Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          }).required(),
        })
      )
      .min(0)
      .max(4)
      .optional()
      .label('Custom Variables'), //Custom variable mapping
    integration_status: Joi.object({
      name: Joi.string().required(),
      picklist_values: Joi.array()
        .items(
          Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          })
        )
        .required(),
      converted: Joi.object({
        label: Joi.string().required(),
        value: Joi.string().required(),
      }).optional(),
      disqualified: Joi.object({
        label: Joi.string().required(),
        value: Joi.string().required(),
      }).optional(),
      custom_actions: Joi.array().items(
        Joi.object({
          label: Joi.string().required(),
          value: Joi.string().required(),
          reasons: Joi.array()
            .items(
              Joi.object({
                label: Joi.string().required(),
                value: Joi.string().required(),
              })
            )
            .optional(),
        })
      ),
    })
      .optional()
      .label('Integration status'),
    disqualification_reason: Joi.object({
      name: Joi.string().required(),
      picklist_values: Joi.array()
        .items(
          Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          })
        )
        .required(),
    })
      .optional()
      .label('Disqualification reason'),
  }).required(),

  lead_map: Joi.object({
    first_name: Joi.string().required(), // FirstName
    last_name: Joi.string().allow('').optional(), // LastName
    linkedin_url: Joi.string().allow('').optional(), // Linkedin__c
    source_site: Joi.string().allow('').optional(), // Source_site__c
    job_position: Joi.string().allow('').optional(), // Title
    phone_numbers: Joi.array().items(Joi.string()).max(5).required(), // Phone, MobilePhone
    emails: Joi.array().items(Joi.string()).max(5).required(), // Emails
    variables: Joi.array()
      .items(
        Joi.object({
          variable_field_name: Joi.string().required(),
          target_value: Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          }).required(),
        })
      )
      .min(0)
      .max(4)
      .optional()
      .label('Custom Variables'), //Custom variable mapping
    integration_status: Joi.object({
      name: Joi.string().required(),
      picklist_values: Joi.array()
        .items(
          Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          })
        )
        .required(),
      converted: Joi.object({
        label: Joi.string().required(),
        value: Joi.string().required(),
      }).optional(),
      disqualified: Joi.object({
        label: Joi.string().required(),
        value: Joi.string().required(),
      }).optional(),
      custom_actions: Joi.array().items(
        Joi.object({
          label: Joi.string().required(),
          value: Joi.string().required(),
          reasons: Joi.array()
            .items(
              Joi.object({
                label: Joi.string().required(),
                value: Joi.string().required(),
              })
            )
            .optional(),
        })
      ),
    })
      .optional()
      .label('Integration status'),
    disqualification_reason: Joi.object({
      name: Joi.string().required(),
      picklist_values: Joi.array()
        .items(
          Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          })
        )
        .required(),
    })
      .optional()
      .label('Disqualification reason'),
  }).required(),

  candidate_map: Joi.object({
    first_name: Joi.string().required(), // FirstName
    last_name: Joi.string().allow('').optional(), // LastName
    linkedin_url: Joi.string().allow('').optional(), // Linkedin__c
    source_site: Joi.string().allow('').optional(), // Source_site__c
    job_position: Joi.string().allow('').optional(), // Title
    company: Joi.string().allow('').optional(),
    size: Joi.alternatives()
      .try(
        Joi.string().allow('').required(),
        Joi.object({
          name: Joi.string().required(),
          picklist_values: Joi.array()
            .items(
              Joi.object({
                label: Joi.string().required(),
                value: Joi.string().required(),
              })
            )
            .required(),
        }).required()
      )
      .optional(),
    url: Joi.string().allow('').optional(),
    country: Joi.string().allow('').optional(),
    zip_code: Joi.string().allow('').optional(),
    phone_numbers: Joi.array().items(Joi.string()).max(5).required(), // Phone, MobilePhone
    emails: Joi.array().items(Joi.string()).max(5).required(), // Emails
    variables: Joi.array()
      .items(
        Joi.object({
          variable_field_name: Joi.string().required(),
          target_value: Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          }).required(),
        })
      )
      .min(0)
      .max(4)
      .optional()
      .label('Custom Variables'), //Custom variable mapping
    integration_status: Joi.object({
      name: Joi.string().required(),
      picklist_values: Joi.array()
        .items(
          Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          })
        )
        .required(),
      converted: Joi.object({
        label: Joi.string().required(),
        value: Joi.string().required(),
      }).optional(),
      disqualified: Joi.object({
        label: Joi.string().required(),
        value: Joi.string().required(),
      }).optional(),
      custom_actions: Joi.array().items(
        Joi.object({
          label: Joi.string().required(),
          value: Joi.string().required(),
          reasons: Joi.array()
            .items(
              Joi.object({
                label: Joi.string().required(),
                value: Joi.string().required(),
              })
            )
            .optional(),
        })
      ),
    })
      .optional()
      .label('Integration status'),
    disqualification_reason: Joi.object({
      name: Joi.string().required(),
      picklist_values: Joi.array()
        .items(
          Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          })
        )
        .required(),
    })
      .optional()
      .label('Disqualification reason'),
  }).required(),

  account_map: Joi.object({
    name: Joi.string().required(), // Name
    size: Joi.alternatives()
      .try(
        Joi.string().allow('').required(),
        Joi.object({
          name: Joi.string().required(),
          picklist_values: Joi.array()
            .items(
              Joi.object({
                label: Joi.string().required(),
                value: Joi.string().required(),
              })
            )
            .required(),
        }).required()
      )
      .optional(), // Effectif__c
    url: Joi.string().allow('').optional(), // Website
    country: Joi.string().allow('').optional(), // BillingCountry
    zip_code: Joi.string().allow('').optional(), // BillingPostalCode
    linkedin_url: Joi.string().allow('').optional(), // Linkedin_Societe__c
    phone_number: Joi.string().allow('').optional(), // Phone,
    variables: Joi.array()
      .items(
        Joi.object({
          variable_field_name: Joi.string().required(),
          target_value: Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          }).required(),
        })
      )
      .min(0)
      .max(4)
      .optional()
      .label('Custom Variables'), //Custom variable mapping
    integration_status: Joi.object({
      name: Joi.string().required(),
      picklist_values: Joi.array()
        .items(
          Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          })
        )
        .required(),
      converted: Joi.object({
        label: Joi.string().required(),
        value: Joi.string().required(),
      }).optional(),
      disqualified: Joi.object({
        label: Joi.string().required(),
        value: Joi.string().required(),
      }).optional(),
      custom_actions: Joi.array().items(
        Joi.object({
          label: Joi.string().required(),
          value: Joi.string().required(),
          reasons: Joi.array()
            .items(
              Joi.object({
                label: Joi.string().required(),
                value: Joi.string().required(),
              })
            )
            .optional(),
        })
      ),
    })
      .optional()
      .label('Integration status'),
    disqualification_reason: Joi.object({
      name: Joi.string().required(),
      picklist_values: Joi.array()
        .items(
          Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          })
        )
        .required(),
    })
      .optional()
      .label('Disqualification reason'),
  }).required(),
});

const bullhornAllExtensionFieldMapSchema = Joi.object({
  contact_map: Joi.object({
    first_name: Joi.string().required(), // FirstName
    last_name: Joi.string().allow('').optional(), // LastName
    linkedin_url: Joi.string().allow('').optional(), // URL_Profil_Linkedin__c
    source_site: Joi.string().allow('').optional(), // Source_site__c
    job_position: Joi.string().allow('').optional(), // Title
    phone_numbers: Joi.array().items(Joi.string()).max(5).required(), // Phone, MobilePhone, OtherPhone, HomePhone, AssistantPhone
    emails: Joi.array().items(Joi.string()).max(5).required(), // Email
    variables: Joi.array()
      .items(
        Joi.object({
          variable_field_name: Joi.string().required(),
          target_value: Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          }).required(),
        })
      )
      .min(0)
      .max(4)
      .optional()
      .label('Custom Variables'), //Custom variable mapping
    integration_status: Joi.object({
      name: Joi.string().required(),
      picklist_values: Joi.array()
        .items(
          Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          })
        )
        .required(),
      converted: Joi.object({
        label: Joi.string().required(),
        value: Joi.string().required(),
      }).optional(),
      disqualified: Joi.object({
        label: Joi.string().required(),
        value: Joi.string().required(),
      }).optional(),
      custom_actions: Joi.array().items(
        Joi.object({
          label: Joi.string().required(),
          value: Joi.string().required(),
          reasons: Joi.array()
            .items(
              Joi.object({
                label: Joi.string().required(),
                value: Joi.string().required(),
              })
            )
            .optional(),
        })
      ),
    })
      .optional()
      .label('Integration status'),
    disqualification_reason: Joi.object({
      name: Joi.string().required(),
      picklist_values: Joi.array()
        .items(
          Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          })
        )
        .required(),
    })
      .optional()
      .label('Disqualification reason'),
  }).required(),

  lead_map: Joi.object({
    first_name: Joi.string().required(), // FirstName
    last_name: Joi.string().allow('').optional(), // LastName
    linkedin_url: Joi.string().allow('').optional(), // Linkedin__c
    source_site: Joi.string().allow('').optional(), // Source_site__c
    job_position: Joi.string().allow('').optional(), // Title
    phone_numbers: Joi.array().items(Joi.string()).max(5).required(), // Phone, MobilePhone
    emails: Joi.array().items(Joi.string()).max(5).required(), // Emails
    variables: Joi.array()
      .items(
        Joi.object({
          variable_field_name: Joi.string().required(),
          target_value: Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          }).required(),
        })
      )
      .min(0)
      .max(4)
      .optional()
      .label('Custom Variables'), //Custom variable mapping
    integration_status: Joi.object({
      name: Joi.string().required(),
      picklist_values: Joi.array()
        .items(
          Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          })
        )
        .required(),
      converted: Joi.object({
        label: Joi.string().required(),
        value: Joi.string().required(),
      }).optional(),
      disqualified: Joi.object({
        label: Joi.string().required(),
        value: Joi.string().required(),
      }).optional(),
      custom_actions: Joi.array().items(
        Joi.object({
          label: Joi.string().required(),
          value: Joi.string().required(),
          reasons: Joi.array()
            .items(
              Joi.object({
                label: Joi.string().required(),
                value: Joi.string().required(),
              })
            )
            .optional(),
        })
      ),
    })
      .optional()
      .label('Integration status'),
    disqualification_reason: Joi.object({
      name: Joi.string().required(),
      picklist_values: Joi.array()
        .items(
          Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          })
        )
        .required(),
    })
      .optional()
      .label('Disqualification reason'),
  }).required(),

  candidate_map: Joi.object({
    first_name: Joi.string().required(), // FirstName
    last_name: Joi.string().allow('').optional(), // LastName
    linkedin_url: Joi.string().allow('').optional(), // Linkedin__c
    source_site: Joi.string().allow('').optional(), // Source_site__c
    job_position: Joi.string().allow('').optional(), // Title
    company: Joi.string().allow('').optional(),
    size: Joi.alternatives()
      .try(
        Joi.string().allow('').required(),
        Joi.object({
          name: Joi.string().required(),
          picklist_values: Joi.array()
            .items(
              Joi.object({
                label: Joi.string().required(),
                value: Joi.string().required(),
              })
            )
            .required(),
        }).required()
      )
      .optional(),
    url: Joi.string().allow('').optional(),
    country: Joi.string().allow('').optional(),
    zip_code: Joi.string().allow('').optional(),
    phone_numbers: Joi.array().items(Joi.string()).max(5).required(), // Phone, MobilePhone
    emails: Joi.array().items(Joi.string()).max(5).required(), // Emails
    variables: Joi.array()
      .items(
        Joi.object({
          variable_field_name: Joi.string().required(),
          target_value: Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          }).required(),
        })
      )
      .min(0)
      .max(4)
      .optional()
      .label('Custom Variables'), //Custom variable mapping
    integration_status: Joi.object({
      name: Joi.string().required(),
      picklist_values: Joi.array()
        .items(
          Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          })
        )
        .required(),
      converted: Joi.object({
        label: Joi.string().required(),
        value: Joi.string().required(),
      }).optional(),
      disqualified: Joi.object({
        label: Joi.string().required(),
        value: Joi.string().required(),
      }).optional(),
      custom_actions: Joi.array().items(
        Joi.object({
          label: Joi.string().required(),
          value: Joi.string().required(),
          reasons: Joi.array()
            .items(
              Joi.object({
                label: Joi.string().required(),
                value: Joi.string().required(),
              })
            )
            .optional(),
        })
      ),
    })
      .optional()
      .label('Integration status'),
    disqualification_reason: Joi.object({
      name: Joi.string().required(),
      picklist_values: Joi.array()
        .items(
          Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          })
        )
        .required(),
    })
      .optional()
      .label('Disqualification reason'),
  }).required(),

  account_map: Joi.object({
    name: Joi.string().required(), // Name
    size: Joi.alternatives()
      .try(
        Joi.string().allow('').required(),
        Joi.object({
          name: Joi.string().required(),
          picklist_values: Joi.array()
            .items(
              Joi.object({
                label: Joi.string().required(),
                value: Joi.string().required(),
              })
            )
            .required(),
        }).required()
      )
      .optional(), // Effectif__c
    url: Joi.string().allow('').optional(), // Website
    country: Joi.string().allow('').optional(), // BillingCountry
    zip_code: Joi.string().allow('').optional(), // BillingPostalCode
    linkedin_url: Joi.string().allow('').optional(), // Linkedin_Societe__c
    phone_number: Joi.string().allow('').optional(), // Phone,
    variables: Joi.array()
      .items(
        Joi.object({
          variable_field_name: Joi.string().required(),
          target_value: Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          }).required(),
        })
      )
      .min(0)
      .max(4)
      .optional()
      .label('Custom Variables'), //Custom variable mapping
    integration_status: Joi.object({
      name: Joi.string().required(),
      picklist_values: Joi.array()
        .items(
          Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          })
        )
        .required(),
      converted: Joi.object({
        label: Joi.string().required(),
        value: Joi.string().required(),
      }).optional(),
      disqualified: Joi.object({
        label: Joi.string().required(),
        value: Joi.string().required(),
      }).optional(),
      custom_actions: Joi.array().items(
        Joi.object({
          label: Joi.string().required(),
          value: Joi.string().required(),
          reasons: Joi.array()
            .items(
              Joi.object({
                label: Joi.string().required(),
                value: Joi.string().required(),
              })
            )
            .optional(),
        })
      ),
    })
      .optional()
      .label('Integration status'),
    disqualification_reason: Joi.object({
      name: Joi.string().required(),
      picklist_values: Joi.array()
        .items(
          Joi.object({
            label: Joi.string().required(),
            value: Joi.string().required(),
          })
        )
        .required(),
    })
      .optional()
      .label('Disqualification reason'),
  }).required(),
});

const createBullhornCustomObject = Joi.object({
  object_type: Joi.string()
    .valid(...Object.values(BULLHORN_ENDPOINTS))
    .required(),
  custom_object: Joi.array()
    .items({
      button_text: Joi.string().required(),
      form: Joi.array()
        .items({
          type: Joi.string()
            .valid(...Object.values(FORM_FIELDS_FOR_CUSTOM_OBJECTS))
            .required(), //<enum> // INPUT_BOX , DROPDOWN, RADIO_BUTTON
          position: {
            row: Joi.number().required(), // <integer> ,
            column: Joi.number().required(), // <integer>
          },
          editable: Joi.bool().required(),
          input_type: Joi.string().optional(),
          bullhorn_field: Joi.string().required(), // <string> // This would be the zoho field,
          bullhorn_label: Joi.string().required(),
          bullhorn_endpoint: Joi.string()
            .valid(...Object.values(BULLHORN_ENDPOINTS))
            .required(), // "contact" , "lead" , "account"
          possible_values: Joi.array().optional(), //<array> (OPTIONAL)
          reference_to: Joi.string().optional(),
        })
        .required(),
    })
    .max(1)
    .required(),
});
const testBullhornCustomObject = Joi.object({
  type: Joi.string()
    .required()
    .valid(...Object.values(BULLHORN_ENDPOINTS)),
  id: Joi.string().required(),
  custom_object: Joi.object().required(),
  custom_object_corporation: Joi.object().optional(),
  bullhorn_corporation_id: Joi.string().optional(),
});

// * Describe dynamics endpoint
const describeDynamicsEndpointSchema = Joi.object({
  object: Joi.string()
    .valid(...Object.values(DYNAMICS_ENDPOINTS))
    .required(),
});

// * Create all dynamics field maps
const dynamicsAllFieldMapSchema = Joi.object({
  contact_map: Joi.object({
    first_name: Joi.string().required(), // FirstName
    last_name: Joi.string().allow('').optional(),
    linkedin_url: Joi.string().allow('').optional(),
    job_position: Joi.string().allow('').optional(),
    phone_numbers: Joi.array().items(Joi.string()).max(5).required(),
    emails: Joi.array().items(Joi.string()).max(5).required(),
  }).required(),

  lead_map: Joi.object({
    first_name: Joi.string().required(), // FirstName
    last_name: Joi.string().allow('').optional(), // LastName
    linkedin_url: Joi.string().allow('').optional(), // Linkedin__c
    source_site: Joi.string().allow('').optional(), // Source_site__c
    job_position: Joi.string().allow('').optional(), // Title
    account: Joi.string().required(),
    size: Joi.alternatives()
      .try(
        Joi.string().allow('').required(),
        Joi.object({
          name: Joi.string().required(),
          picklist_values: Joi.array()
            .items(
              Joi.object({
                label: Joi.string().required(),
                value: Joi.string().required(),
              })
            )
            .required(),
        }).required()
      )
      .optional(),
    url: Joi.string().allow('').optional(),
    country: Joi.string().allow('').optional(),
    zip_code: Joi.string().allow('').optional(),
    phone_numbers: Joi.array().items(Joi.string()).max(5).required(), // Phone, MobilePhone
    company_phone_number: Joi.string().allow('').optional(),
    emails: Joi.array().items(Joi.string()).max(5).required(), // Emails
  }).required(),

  account_map: Joi.object({
    name: Joi.string().required(),
    size: Joi.alternatives()
      .try(
        Joi.string().allow('').required(),
        Joi.object({
          name: Joi.string().required(),
          picklist_values: Joi.array()
            .items(
              Joi.object({
                label: Joi.string().required(),
                value: Joi.string().required(),
              })
            )
            .required(),
        }).required()
      )
      .optional(),
    url: Joi.string().allow('').optional(),
    country: Joi.string().allow('').optional(),
    zip_code: Joi.string().allow('').optional(),
    linkedin_url: Joi.string().allow('').optional(),
    phone_number: Joi.string().allow('').optional(),
  }).required(),
});

// * Test dynamics field map with a lead/contact
const testDynamicsFieldMap = Joi.object({
  dynamics_id: Joi.string().required(),
  type: Joi.string()
    .valid(...Object.values(DYNAMICS_ENDPOINTS))
    .required(),
  contact_map: Joi.object(),
  account_map: Joi.object(),
  lead_map: Joi.object(),
});
const createDynamicsCustomObject = Joi.object({
  object_type: Joi.string()
    .valid(...Object.values(DYNAMICS_ENDPOINTS))
    .required()
    .label('Object type'),
  custom_object: Joi.array()
    .items({
      button_text: Joi.string().required().label('Button Text'),
      form: Joi.array()
        .items({
          type: Joi.string()
            .valid(...Object.values(FORM_FIELDS_FOR_CUSTOM_OBJECTS))
            .required()
            .label('Type'), //<enum> // INPUT_BOX , DROPDOWN, RADIO_BUTTON
          position: {
            row: Joi.number().required().label('Row'), // <integer> ,
            column: Joi.number().required().label('Column'), // <integer>
          },
          editable: Joi.bool().required().label('Editable'),
          input_type: Joi.string().optional().label('Input Type'),
          dynamics_field: Joi.string().required().label('Dynamics field'), // <string> // This would be the zoho field,
          dynamics_label: Joi.string().required().label('Dynamics label'),
          dynamics_endpoint: Joi.string()
            .valid(...Object.values(DYNAMICS_ENDPOINTS))
            .required()
            .label('Dynamics endpoint'), // "contact" , "lead" , "account"
          possible_values: Joi.array().optional().label('Possible values'), //<array> (OPTIONAL)
          reference_to: Joi.string().optional().label('Reference to'),
        })
        .required()
        .label('Form'),
    })
    .max(1)
    .required()
    .label('Custom object'),
});
const testDynamicsCustomObject = Joi.object({
  type: Joi.string()
    .required()
    .valid(...Object.values(DYNAMICS_ENDPOINTS))
    .label('Type'),
  id: Joi.string().required().label('Id'),
  custom_object: Joi.object().required().label('Custom object'),
  custom_object_account: Joi.object().optional().label('Custom object account'),
  dynamics_account_id: Joi.string().optional().label('Dynamics account id'),
});
const testDynamicsObject = Joi.object({
  type: Joi.string()
    .required()
    .valid(...Object.values(DYNAMICS_ENDPOINTS))
    .label('Type'),
  id: Joi.string().required().label('Id'),
});
const describeBullhornPicklist = Joi.object({
  object: Joi.string().valid('country').required(),
});

module.exports = {
  salesforceCreateFieldMapSchema,
  describeSalesforceObjectSchema,
  testSalesforceFieldMap,
  salesforceAllFieldMapSchema,
  salesforceAllExtensionFieldMapSchema,
  createSalesforceCustomObject,
  testSalesforceCustomObject,
  pipedriveCreateFieldMapSchema,
  describePipedriveEndpointSchema,
  pipedriveAllCreateFieldMapSchema,
  testPipedriveFieldMap,
  createPipedriveCustomObject,
  testPipedriveCustomObject,
  hubspotCreateFieldMapSchema,
  hubspotAllFieldMapSchema,
  describeHubspotEndpointSchema,
  testHubspotFieldMap,
  createHubspotCustomObject,
  testHubspotCustomObject,
  testHubspotObject,
  zohoCreateFieldMapSchema,
  zohoAllFieldMapSchema,
  describeZohoObjectSchema,
  testZohoFieldMap,
  testZohoCustomObject,
  createZohoCustomObject,
  sellsyCreateFieldMapSchema,
  describeSellsyEndpointSchema,
  sellsyAllFieldMapSchema,
  testSellsyFieldMap,
  createSellsyCustomObject,
  testSellsyCustomObject,
  testSellsyObject,
  testZohoObject,
  describeBullhornObjectSchema,
  testBullhornFieldMap,
  testBullhornObject,
  bullhornAllFieldMapSchema,
  createBullhornCustomObject,
  testBullhornCustomObject,
  describeDynamicsEndpointSchema,
  dynamicsAllFieldMapSchema,
  testDynamicsFieldMap,
  createDynamicsCustomObject,
  testDynamicsCustomObject,
  testDynamicsObject,
  describeBullhornPicklist,
  bullhornAllExtensionFieldMapSchema,
};
