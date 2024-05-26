// Packages
const Joi = require('joi');

// Utils

const {
  TEMPLATE_LEVEL,
  TEMPLATE_TYPE,
} = require('../../../../../../Cadence-Brain/src/utils/enums');

const createEmailTemplateSchema = Joi.object({
  name: Joi.string().required(),
  subject: Joi.string().required(),
  body: Joi.string().required(),
  level: Joi.string()
    .valid(...Object.values(TEMPLATE_LEVEL))
    .required(),
  type: Joi.string()
    .valid(...Object.values(TEMPLATE_TYPE))
    .required(),
  linkText: Joi.string().allow('').optional(),
  redirectUrl: Joi.string().allow('').optional(),
  company_id: Joi.alternatives()
    .conditional('level', {
      switch: [
        {
          is: TEMPLATE_LEVEL.PERSONAL,
          then: Joi.valid(null),
        },
        {
          is: TEMPLATE_LEVEL.TEAM,
          then: Joi.valid(null),
        },
        {
          is: TEMPLATE_LEVEL.COMPANY,
          then: Joi.string().guid().required(),
        },
      ],
    })
    .required(),
  sd_id: Joi.alternatives()
    .conditional('level', {
      switch: [
        {
          is: TEMPLATE_LEVEL.PERSONAL,
          then: Joi.valid(null),
        },
        {
          is: TEMPLATE_LEVEL.TEAM,
          then: Joi.string().guid().required(),
        },
        {
          is: TEMPLATE_LEVEL.COMPANY,
          then: Joi.valid(null),
        },
      ],
    })
    .required(),
  company_id: Joi.string().optional().allow(null),
  sd_id: Joi.string().optional().allow(null),
  attachment_ids: Joi.array().items(Joi.number()).optional(),
});

const createMessageTemplateSchema = Joi.object({
  name: Joi.string().required(),
  message: Joi.string().trim().max(1400).required().messages({
    'string.max':
      'Total length allowed {#limit} characters. Your message exceeds the total length.',
  }),
  level: Joi.string()
    .valid(...Object.values(TEMPLATE_LEVEL))
    .required(),
  type: Joi.string()
    .valid(...Object.values(TEMPLATE_TYPE))
    .required(),
  company_id: Joi.alternatives()
    .conditional('level', {
      switch: [
        {
          is: TEMPLATE_LEVEL.PERSONAL,
          then: Joi.valid(null),
        },
        {
          is: TEMPLATE_LEVEL.TEAM,
          then: Joi.valid(null),
        },
        {
          is: TEMPLATE_LEVEL.COMPANY,
          then: Joi.string().guid().required(),
        },
      ],
    })
    .required(),
  sd_id: Joi.alternatives()
    .conditional('level', {
      switch: [
        {
          is: TEMPLATE_LEVEL.PERSONAL,
          then: Joi.valid(null),
        },
        {
          is: TEMPLATE_LEVEL.TEAM,
          then: Joi.string().guid().required(),
        },
        {
          is: TEMPLATE_LEVEL.COMPANY,
          then: Joi.valid(null),
        },
      ],
    })
    .required(),
  company_id: Joi.string().optional().allow(null),
  sd_id: Joi.string().optional().allow(null),
});

const createScriptTemplateSchema = Joi.object({
  name: Joi.string().required(),
  script: Joi.string().trim().max(15000).required().messages({
    'string.max':
      'Total length allowed {#limit} characters. Your script exceeds the total length.',
  }),
  level: Joi.string()
    .valid(...Object.values(TEMPLATE_LEVEL))
    .required(),
  type: Joi.string()
    .valid(...Object.values(TEMPLATE_TYPE))
    .required(),
  company_id: Joi.alternatives()
    .conditional('level', {
      switch: [
        {
          is: TEMPLATE_LEVEL.PERSONAL,
          then: Joi.valid(null),
        },
        {
          is: TEMPLATE_LEVEL.TEAM,
          then: Joi.valid(null),
        },
        {
          is: TEMPLATE_LEVEL.COMPANY,
          then: Joi.string().guid().required(),
        },
      ],
    })
    .required(),
  sd_id: Joi.alternatives()
    .conditional('level', {
      switch: [
        {
          is: TEMPLATE_LEVEL.PERSONAL,
          then: Joi.valid(null),
        },
        {
          is: TEMPLATE_LEVEL.TEAM,
          then: Joi.string().guid().required(),
        },
        {
          is: TEMPLATE_LEVEL.COMPANY,
          then: Joi.valid(null),
        },
      ],
    })
    .required(),
  company_id: Joi.string().optional().allow(null),
  sd_id: Joi.string().optional().allow(null),
});

const createLinkedInTemplateSchema = Joi.object({
  name: Joi.string().required(),
  message: Joi.string().trim().max(1400).required().messages({
    'string.max':
      'Total length allowed {#limit} characters. Your message exceeds the total length.',
  }),
  level: Joi.string()
    .valid(...Object.values(TEMPLATE_LEVEL))
    .required(),
  type: Joi.string()
    .valid(...Object.values(TEMPLATE_TYPE))
    .required(),
  company_id: Joi.alternatives()
    .conditional('level', {
      switch: [
        {
          is: TEMPLATE_LEVEL.PERSONAL,
          then: Joi.valid(null),
        },
        {
          is: TEMPLATE_LEVEL.TEAM,
          then: Joi.valid(null),
        },
        {
          is: TEMPLATE_LEVEL.COMPANY,
          then: Joi.string().guid().required(),
        },
      ],
    })
    .required(),
  sd_id: Joi.alternatives()
    .conditional('level', {
      switch: [
        {
          is: TEMPLATE_LEVEL.PERSONAL,
          then: Joi.valid(null),
        },
        {
          is: TEMPLATE_LEVEL.TEAM,
          then: Joi.string().guid().required(),
        },
        {
          is: TEMPLATE_LEVEL.COMPANY,
          then: Joi.valid(null),
        },
      ],
    })
    .required(),
  company_id: Joi.string().optional().allow(null),
  sd_id: Joi.string().optional().allow(null),
});

const createWhatsappTemplateSchema = Joi.object({
  name: Joi.string().required(),
  message: Joi.string().trim().max(500).required().messages({
    'string.max':
      'Total length allowed {#limit} characters. Your message exceeds the total length.',
  }),
  level: Joi.string()
    .valid(...Object.values(TEMPLATE_LEVEL))
    .required(),
  type: Joi.string()
    .valid(...Object.values(TEMPLATE_TYPE))
    .required(),
  company_id: Joi.alternatives()
    .conditional('level', {
      switch: [
        {
          is: TEMPLATE_LEVEL.PERSONAL,
          then: Joi.valid(null),
        },
        {
          is: TEMPLATE_LEVEL.TEAM,
          then: Joi.valid(null),
        },
        {
          is: TEMPLATE_LEVEL.COMPANY,
          then: Joi.string().guid().required(),
        },
      ],
    })
    .required(),
  sd_id: Joi.alternatives()
    .conditional('level', {
      switch: [
        {
          is: TEMPLATE_LEVEL.PERSONAL,
          then: Joi.valid(null),
        },
        {
          is: TEMPLATE_LEVEL.TEAM,
          then: Joi.string().guid().required(),
        },
        {
          is: TEMPLATE_LEVEL.COMPANY,
          then: Joi.valid(null),
        },
      ],
    })
    .required(),
  company_id: Joi.string().optional().allow(null),
  sd_id: Joi.string().optional().allow(null),
});

const createVideoTemplateSchema = Joi.object({
  name: Joi.string().required(),
  video_id: Joi.string().required(),
  level: Joi.string()
    .valid(...Object.values(TEMPLATE_LEVEL))
    .required(),
  type: Joi.string()
    .valid(...Object.values(TEMPLATE_TYPE))
    .required(),
  company_id: Joi.alternatives()
    .conditional('level', {
      switch: [
        {
          is: TEMPLATE_LEVEL.PERSONAL,
          then: Joi.valid(null),
        },
        {
          is: TEMPLATE_LEVEL.TEAM,
          then: Joi.valid(null),
        },
        {
          is: TEMPLATE_LEVEL.COMPANY,
          then: Joi.string().guid().required(),
        },
      ],
    })
    .required(),
  sd_id: Joi.alternatives()
    .conditional('level', {
      switch: [
        {
          is: TEMPLATE_LEVEL.PERSONAL,
          then: Joi.valid(null),
        },
        {
          is: TEMPLATE_LEVEL.TEAM,
          then: Joi.string().guid().required(),
        },
        {
          is: TEMPLATE_LEVEL.COMPANY,
          then: Joi.valid(null),
        },
      ],
    })
    .required(),
  company_id: Joi.string().optional().allow(null),
  sd_id: Joi.string().optional().allow(null),
});

const updateEmailTemplateSchema = Joi.object({
  type: Joi.string()
    .valid(...Object.values(TEMPLATE_TYPE))
    .required(),
  et_id: Joi.number().required(),
  name: Joi.string().optional(),
  subject: Joi.string().optional(),
  body: Joi.string().optional(),
  Attachments: Joi.array().optional(),
  created_at: Joi.date().timestamp().iso().optional(),
  updated_at: Joi.date().timestamp().iso().optional(),
  level: Joi.string()
    .valid(...Object.values(TEMPLATE_LEVEL))
    .required(),
  sd_id: Joi.alternatives().conditional('level', {
    switch: [
      {
        is: TEMPLATE_LEVEL.PERSONAL,
        then: Joi.valid(null),
      },
      {
        is: TEMPLATE_LEVEL.TEAM,
        then: Joi.string().guid().required(),
      },
      {
        is: TEMPLATE_LEVEL.COMPANY,
        then: Joi.valid(null),
      },
    ],
  }),
  company_id: Joi.alternatives().conditional('level', {
    switch: [
      {
        is: TEMPLATE_LEVEL.PERSONAL,
        then: Joi.valid(null),
      },
      {
        is: TEMPLATE_LEVEL.TEAM,
        then: Joi.valid(null),
      },
      {
        is: TEMPLATE_LEVEL.COMPANY,
        then: Joi.string().guid().required(),
      },
    ],
  }),

  user_id: Joi.string().optional(),
  linkText: Joi.string().allow('').optional(),
  redirectUrl: Joi.string().allow('').optional(),
  attachment_ids: Joi.array().items(Joi.number()).optional(),
});

const updateMessageTemplateSchema = Joi.object({
  type: Joi.string()
    .valid(...Object.values(TEMPLATE_TYPE))
    .required(),
  mt_id: Joi.number().required(),
  name: Joi.string().trim().max(1400).optional().messages({
    'string.max':
      'Total length allowed {#limit} characters. Your message exceeds the total length.',
  }),
  message: Joi.string().optional(),
  level: Joi.string()
    .valid(...Object.values(TEMPLATE_LEVEL))
    .required(),
  sd_id: Joi.alternatives().conditional('level', {
    switch: [
      {
        is: TEMPLATE_LEVEL.PERSONAL,
        then: Joi.valid(null),
      },
      {
        is: TEMPLATE_LEVEL.TEAM,
        then: Joi.string().guid().required(),
      },
      {
        is: TEMPLATE_LEVEL.COMPANY,
        then: Joi.valid(null),
      },
    ],
  }),
  company_id: Joi.alternatives().conditional('level', {
    switch: [
      {
        is: TEMPLATE_LEVEL.PERSONAL,
        then: Joi.valid(null),
      },
      {
        is: TEMPLATE_LEVEL.TEAM,
        then: Joi.valid(null),
      },
      {
        is: TEMPLATE_LEVEL.COMPANY,
        then: Joi.string().guid().required(),
      },
    ],
  }),
  user_id: Joi.string().optional(),
  created_at: Joi.date().timestamp().iso().optional(),
  updated_at: Joi.date().timestamp().iso().optional(),
});

const updateLinkedinTemplateSchema = Joi.object({
  type: Joi.string()
    .valid(...Object.values(TEMPLATE_TYPE))
    .required(),
  lt_id: Joi.number().required(),
  name: Joi.string().optional(),
  message: Joi.string().trim().max(1400).optional().messages({
    'string.max':
      'Total length allowed {#limit} characters. Your message exceeds the total length.',
  }),
  sd_id: Joi.alternatives().conditional('level', {
    switch: [
      {
        is: TEMPLATE_LEVEL.PERSONAL,
        then: Joi.valid(null),
      },
      {
        is: TEMPLATE_LEVEL.TEAM,
        then: Joi.string().guid().required(),
      },
      {
        is: TEMPLATE_LEVEL.COMPANY,
        then: Joi.valid(null),
      },
    ],
  }),
  company_id: Joi.alternatives().conditional('level', {
    switch: [
      {
        is: TEMPLATE_LEVEL.PERSONAL,
        then: Joi.valid(null),
      },
      {
        is: TEMPLATE_LEVEL.TEAM,
        then: Joi.valid(null),
      },
      {
        is: TEMPLATE_LEVEL.COMPANY,
        then: Joi.string().guid().required(),
      },
    ],
  }),
  user_id: Joi.string().optional(),
  level: Joi.string()
    .valid(...Object.values(TEMPLATE_LEVEL))
    .required(),
  created_at: Joi.date().timestamp().iso().optional(),
  updated_at: Joi.date().timestamp().iso().optional(),
});

const updateWhatsappTemplateSchema = Joi.object({
  type: Joi.string()
    .valid(...Object.values(TEMPLATE_TYPE))
    .required(),
  wt_id: Joi.number().required(),
  name: Joi.string().optional(),
  message: Joi.string().trim().max(500).optional().messages({
    'string.max':
      'Total length allowed {#limit} characters. Your message exceeds the total length.',
  }),
  sd_id: Joi.alternatives().conditional('level', {
    switch: [
      {
        is: TEMPLATE_LEVEL.PERSONAL,
        then: Joi.valid(null),
      },
      {
        is: TEMPLATE_LEVEL.TEAM,
        then: Joi.string().guid().required(),
      },
      {
        is: TEMPLATE_LEVEL.COMPANY,
        then: Joi.valid(null),
      },
    ],
  }),
  company_id: Joi.alternatives().conditional('level', {
    switch: [
      {
        is: TEMPLATE_LEVEL.PERSONAL,
        then: Joi.valid(null),
      },
      {
        is: TEMPLATE_LEVEL.TEAM,
        then: Joi.valid(null),
      },
      {
        is: TEMPLATE_LEVEL.COMPANY,
        then: Joi.string().guid().required(),
      },
    ],
  }),
  user_id: Joi.string().optional(),
  level: Joi.string()
    .valid(...Object.values(TEMPLATE_LEVEL))
    .required(),
  created_at: Joi.date().timestamp().iso().optional(),
  updated_at: Joi.date().timestamp().iso().optional(),
});

const updateScriptTemplateSchema = Joi.object({
  type: Joi.string()
    .valid(...Object.values(TEMPLATE_TYPE))
    .required(),
  st_id: Joi.number().required(),
  name: Joi.string().optional(),
  script: Joi.string().trim().max(15000).optional().messages({
    'string.max':
      'Total length allowed {#limit} characters. Your script exceeds the total length.',
  }),
  level: Joi.string()
    .valid(...Object.values(TEMPLATE_LEVEL))
    .required(),

  sd_id: Joi.alternatives().conditional('level', {
    switch: [
      {
        is: TEMPLATE_LEVEL.PERSONAL,
        then: Joi.valid(null),
      },
      {
        is: TEMPLATE_LEVEL.TEAM,
        then: Joi.string().guid().required(),
      },
      {
        is: TEMPLATE_LEVEL.COMPANY,
        then: Joi.valid(null),
      },
    ],
  }),
  company_id: Joi.alternatives().conditional('level', {
    switch: [
      {
        is: TEMPLATE_LEVEL.PERSONAL,
        then: Joi.valid(null),
      },
      {
        is: TEMPLATE_LEVEL.TEAM,
        then: Joi.valid(null),
      },
      {
        is: TEMPLATE_LEVEL.COMPANY,
        then: Joi.string().guid().required(),
      },
    ],
  }),
  user_id: Joi.string().optional(),
  created_at: Joi.date().timestamp().iso().optional(),
  updated_at: Joi.date().timestamp().iso().optional(),
});

const updateVideoTemplateSchema = Joi.object({
  type: Joi.string()
    .valid(...Object.values(TEMPLATE_TYPE))
    .required(),
  vt_id: Joi.number().required(),
  name: Joi.string().optional(),
  level: Joi.string()
    .valid(...Object.values(TEMPLATE_LEVEL))
    .required(),
  sd_id: Joi.alternatives().conditional('level', {
    switch: [
      {
        is: TEMPLATE_LEVEL.PERSONAL,
        then: Joi.valid(null),
      },
      {
        is: TEMPLATE_LEVEL.TEAM,
        then: Joi.string().guid().required(),
      },
      {
        is: TEMPLATE_LEVEL.COMPANY,
        then: Joi.valid(null),
      },
    ],
  }),
  company_id: Joi.alternatives().conditional('level', {
    switch: [
      {
        is: TEMPLATE_LEVEL.PERSONAL,
        then: Joi.valid(null),
      },
      {
        is: TEMPLATE_LEVEL.TEAM,
        then: Joi.valid(null),
      },
      {
        is: TEMPLATE_LEVEL.COMPANY,
        then: Joi.string().guid().required(),
      },
    ],
  }),
  user_id: Joi.string().optional(),
  created_at: Joi.date().timestamp().iso().optional(),
  updated_at: Joi.date().timestamp().iso().optional(),
});

const duplicateEmailTemplateSchema = Joi.object({
  et_id: Joi.number().required(),
  name: Joi.string().required(),
  subject: Joi.string().required(),
  body: Joi.string().required(),
  level: Joi.string()
    .valid(...Object.values(TEMPLATE_LEVEL))
    .required(),
  type: Joi.string()
    .valid(...Object.values(TEMPLATE_TYPE))
    .required(),
  // linkText: Joi.string().optional(),
  // redirectUrl: Joi.string().optional(),
  user_id: Joi.string().required(),
  company_id: Joi.alternatives()
    .conditional('level', {
      switch: [
        {
          is: TEMPLATE_LEVEL.PERSONAL,
          then: Joi.valid(null),
        },
        {
          is: TEMPLATE_LEVEL.TEAM,
          then: Joi.valid(null),
        },
        {
          is: TEMPLATE_LEVEL.COMPANY,
          then: Joi.string().guid().required(),
        },
      ],
    })
    .required()
    .messages({
      'string.base': 'Select a valid company',
    }),
  sd_id: Joi.alternatives()
    .conditional('level', {
      switch: [
        {
          is: TEMPLATE_LEVEL.PERSONAL,
          then: Joi.valid(null),
        },
        {
          is: TEMPLATE_LEVEL.TEAM,
          then: Joi.string().guid().required(),
        },
        {
          is: TEMPLATE_LEVEL.COMPANY,
          then: Joi.valid(null),
        },
      ],
    })
    .required()
    .messages({
      'string.base': 'Select a valid sub-department',
    }),
  created_at: Joi.date().timestamp().iso().optional(),
  updated_at: Joi.date().timestamp().iso().optional(),
});

const duplicateLinkedinTemplateSchema = Joi.object({
  lt_id: Joi.number().required(),
  name: Joi.string().required(),
  message: Joi.string().required(),
  level: Joi.string()
    .valid(...Object.values(TEMPLATE_LEVEL))
    .required(),
  type: Joi.string()
    .valid(...Object.values(TEMPLATE_TYPE))
    .required(),

  company_id: Joi.alternatives()
    .conditional('level', {
      switch: [
        {
          is: TEMPLATE_LEVEL.PERSONAL,
          then: Joi.valid(null),
        },
        {
          is: TEMPLATE_LEVEL.TEAM,
          then: Joi.valid(null),
        },
        {
          is: TEMPLATE_LEVEL.COMPANY,
          then: Joi.string().required(),
        },
      ],
    })
    .required()
    .messages({
      'string.base': 'Select a valid company',
    }),
  sd_id: Joi.alternatives()
    .conditional('level', {
      switch: [
        {
          is: TEMPLATE_LEVEL.PERSONAL,
          then: Joi.valid(null),
        },
        {
          is: TEMPLATE_LEVEL.TEAM,
          then: Joi.string().guid().required(),
        },
        {
          is: TEMPLATE_LEVEL.COMPANY,
          then: Joi.valid(null),
        },
      ],
    })
    .required()
    .messages({
      'string.base': 'Select a valid sub-department',
    }),
  user_id: Joi.string().required(),
  created_at: Joi.date().timestamp().iso().optional(),
  updated_at: Joi.date().timestamp().iso().optional(),
});

const duplicateWhatsappTemplateSchema = Joi.object({
  wt_id: Joi.number().required(),
  name: Joi.string().required(),
  message: Joi.string().required(),
  level: Joi.string()
    .valid(...Object.values(TEMPLATE_LEVEL))
    .required(),
  type: Joi.string()
    .valid(...Object.values(TEMPLATE_TYPE))
    .required(),

  company_id: Joi.alternatives()
    .conditional('level', {
      switch: [
        {
          is: TEMPLATE_LEVEL.PERSONAL,
          then: Joi.valid(null),
        },
        {
          is: TEMPLATE_LEVEL.TEAM,
          then: Joi.valid(null),
        },
        {
          is: TEMPLATE_LEVEL.COMPANY,
          then: Joi.string().required(),
        },
      ],
    })
    .required()
    .messages({
      'string.base': 'Select a valid company',
    }),
  sd_id: Joi.alternatives()
    .conditional('level', {
      switch: [
        {
          is: TEMPLATE_LEVEL.PERSONAL,
          then: Joi.valid(null),
        },
        {
          is: TEMPLATE_LEVEL.TEAM,
          then: Joi.string().guid().required(),
        },
        {
          is: TEMPLATE_LEVEL.COMPANY,
          then: Joi.valid(null),
        },
      ],
    })
    .required()
    .messages({
      'string.base': 'Select a valid sub-department',
    }),
  user_id: Joi.string().required(),
  created_at: Joi.date().timestamp().iso().optional(),
  updated_at: Joi.date().timestamp().iso().optional(),
});

const duplicateMessageTemplateSchema = Joi.object({
  mt_id: Joi.number().required(),
  name: Joi.string().required(),
  message: Joi.string().required(),
  level: Joi.string()
    .valid(...Object.values(TEMPLATE_LEVEL))
    .required(),
  type: Joi.string()
    .valid(...Object.values(TEMPLATE_TYPE))
    .required(),

  company_id: Joi.alternatives()
    .conditional('level', {
      switch: [
        {
          is: TEMPLATE_LEVEL.PERSONAL,
          then: Joi.valid(null),
        },
        {
          is: TEMPLATE_LEVEL.TEAM,
          then: Joi.valid(null),
        },
        {
          is: TEMPLATE_LEVEL.COMPANY,
          then: Joi.string().required(),
        },
      ],
    })
    .required()
    .messages({
      'string.base': 'Select a valid company',
    }),
  sd_id: Joi.alternatives()
    .conditional('level', {
      switch: [
        {
          is: TEMPLATE_LEVEL.PERSONAL,
          then: Joi.valid(null),
        },
        {
          is: TEMPLATE_LEVEL.TEAM,
          then: Joi.string().guid().required(),
        },
        {
          is: TEMPLATE_LEVEL.COMPANY,
          then: Joi.valid(null),
        },
      ],
    })
    .required()
    .messages({
      'string.base': 'Select a valid sub-department',
    }),
  user_id: Joi.string().required(),
  created_at: Joi.date().timestamp().iso().optional(),
  updated_at: Joi.date().timestamp().iso().optional(),
});

const duplicateScriptTemplateSchema = Joi.object({
  st_id: Joi.number().required(),
  name: Joi.string().required(),
  script: Joi.string().required(),
  level: Joi.string()
    .valid(...Object.values(TEMPLATE_LEVEL))
    .required(),
  type: Joi.string()
    .valid(...Object.values(TEMPLATE_TYPE))
    .required(),

  company_id: Joi.alternatives()
    .conditional('level', {
      switch: [
        {
          is: TEMPLATE_LEVEL.PERSONAL,
          then: Joi.valid(null),
        },
        {
          is: TEMPLATE_LEVEL.TEAM,
          then: Joi.valid(null),
        },
        {
          is: TEMPLATE_LEVEL.COMPANY,
          then: Joi.string().required(),
        },
      ],
    })
    .required()
    .messages({
      'string.base': 'Select a valid company',
    }),
  sd_id: Joi.alternatives()
    .conditional('level', {
      switch: [
        {
          is: TEMPLATE_LEVEL.PERSONAL,
          then: Joi.valid(null),
        },
        {
          is: TEMPLATE_LEVEL.TEAM,
          then: Joi.string().guid().required(),
        },
        {
          is: TEMPLATE_LEVEL.COMPANY,
          then: Joi.valid(null),
        },
      ],
    })
    .required()
    .messages({
      'string.base': 'Select a valid sub-department',
    }),
  user_id: Joi.string().required(),
  created_at: Joi.date().timestamp().iso().optional(),
  updated_at: Joi.date().timestamp().iso().optional(),
});

const duplicateVideoTemplateSchema = Joi.object({
  vt_id: Joi.number().required(),
  name: Joi.string().required(),
  Video: Joi.object().required(),
  Video_Trackings: Joi.array().items(Joi.object()).optional(),
  level: Joi.string()
    .valid(...Object.values(TEMPLATE_LEVEL))
    .required(),
  type: Joi.string()
    .valid(...Object.values(TEMPLATE_TYPE))
    .required(),

  company_id: Joi.alternatives()
    .conditional('level', {
      switch: [
        {
          is: TEMPLATE_LEVEL.PERSONAL,
          then: Joi.valid(null),
        },
        {
          is: TEMPLATE_LEVEL.TEAM,
          then: Joi.valid(null),
        },
        {
          is: TEMPLATE_LEVEL.COMPANY,
          then: Joi.string().required(),
        },
      ],
    })
    .required()
    .messages({
      'string.base': 'Select a valid company',
    }),
  sd_id: Joi.alternatives()
    .conditional('level', {
      switch: [
        {
          is: TEMPLATE_LEVEL.PERSONAL,
          then: Joi.valid(null),
        },
        {
          is: TEMPLATE_LEVEL.TEAM,
          then: Joi.string().guid().required(),
        },
        {
          is: TEMPLATE_LEVEL.COMPANY,
          then: Joi.valid(null),
        },
      ],
    })
    .required()
    .messages({
      'string.base': 'Select a valid sub-department',
    }),
  user_id: Joi.string().required(),
  created_at: Joi.date().timestamp().iso().optional(),
  updated_at: Joi.date().timestamp().iso().optional(),
});

const shareEmailTemplateSchema = duplicateEmailTemplateSchema;
const shareLinkedinTemplateSchema = duplicateLinkedinTemplateSchema;
const shareWhatsappTemplateSchema = duplicateWhatsappTemplateSchema;
const shareMessageTemplateSchema = duplicateMessageTemplateSchema;
const shareScriptTemplateSchema = duplicateScriptTemplateSchema;
const shareVideoTemplateSchema = duplicateVideoTemplateSchema;

const templatesSchema = {
  createEmailTemplateSchema,
  createLinkedInTemplateSchema,
  createWhatsappTemplateSchema,
  createMessageTemplateSchema,
  createScriptTemplateSchema,
  createVideoTemplateSchema,
  updateEmailTemplateSchema,
  updateLinkedinTemplateSchema,
  updateWhatsappTemplateSchema,
  updateMessageTemplateSchema,
  updateScriptTemplateSchema,
  updateVideoTemplateSchema,
  duplicateEmailTemplateSchema,
  duplicateLinkedinTemplateSchema,
  duplicateWhatsappTemplateSchema,
  duplicateMessageTemplateSchema,
  duplicateScriptTemplateSchema,
  duplicateVideoTemplateSchema,
  shareEmailTemplateSchema,
  shareLinkedinTemplateSchema,
  shareWhatsappTemplateSchema,
  shareMessageTemplateSchema,
  shareScriptTemplateSchema,
  shareVideoTemplateSchema,
};

module.exports = templatesSchema;
