'use strict';

const express = require('express');
const { imageLimiter } = require('../middleware/rateLimit');
const { proxyImageUrl } = require('../services/imageProxy');

const router = express.Router();
router.get('/', imageLimiter, proxyImageUrl);

module.exports = { router };
