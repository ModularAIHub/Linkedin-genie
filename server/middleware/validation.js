import Joi from 'joi';

export const validateRequest = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: 'Validation error', details: error.details.map(detail => detail.message) });
    }
    next();
  };
};

export const postSchema = Joi.object({
  post_content: Joi.string().min(1).max(3000).required(),
  media_urls: Joi.array().items(Joi.string()).max(10).optional(),
  post_type: Joi.string().valid('single_post', 'carousel').optional(),
  company_id: Joi.string().optional()
});

export const aiGenerateSchema = Joi.object({
  prompt: Joi.string().min(10).max(1000).required(),
  style: Joi.string().valid('professional', 'casual', 'witty', 'inspirational').optional()
});
