'use strict';

const express = require('express');
const { db } = require('../db');

const router = express.Router();

/** GET /api/ads — enabled ad slots (public; the client renders them). */
router.get('/', (req, res) => {
  const slots = db
    .prepare('SELECT slot_key, name, html, position FROM ad_slots WHERE enabled = 1 ORDER BY id')
    .all()
    .map((s) => {
      let position = {};
      try {
        position = JSON.parse(s.position || '{}');
      } catch {
        /* empty */
      }
      return { key: s.slot_key, name: s.name, html: s.html, position };
    });
  res.json({ slots });
});

module.exports = router;
