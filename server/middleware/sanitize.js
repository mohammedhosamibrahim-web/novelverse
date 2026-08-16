'use strict';

const sanitizeHtml = require('sanitize-html');

/** Allowed formatting for user comments. Scripts, event handlers, and
 *  dangerous URLs are stripped. */
const COMMENT_OPTIONS = {
  allowedTags: ['b', 'strong', 'i', 'em', 'u', 's', 'p', 'br', 'a', 'code', 'ul', 'ol', 'li', 'blockquote', 'span'],
  allowedAttributes: {
    a: ['href', 'title'],
    span: ['class'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
  },
};

/** Content fetched from external sources (novel chapters). Very strict:
 *  inline text markup only, no links, no attributes. */
const CONTENT_OPTIONS = {
  allowedTags: ['p', 'br', 'strong', 'em', 'b', 'i', 'h1', 'h2', 'h3', 'hr', 'ul', 'ol', 'li', 'blockquote', 'span'],
  allowedAttributes: {},
  allowedSchemes: [],
};

function sanitizeComment(html) {
  return sanitizeHtml(String(html || ''), COMMENT_OPTIONS).slice(0, 4000);
}

function sanitizeContent(html) {
  return sanitizeHtml(String(html || ''), CONTENT_OPTIONS);
}

/** Validate a plain-text string is non-empty after trimming. */
function cleanText(value, maxLen) {
  return String(value || '').trim().slice(0, maxLen || 1000);
}

module.exports = { sanitizeComment, sanitizeContent, cleanText };
