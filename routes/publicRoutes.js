const express = require('express');
const publicController = require('../controllers/publicController');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.get('/', asyncHandler(publicController.home));
router.get('/home', asyncHandler(publicController.home));
router.get('/about', publicController.about);
router.get('/features', publicController.features);
router.get('/pricing', publicController.pricing);
router.get('/help', publicController.help);
router.get('/contact', publicController.contact);
router.get('/terms', publicController.terms);
router.get('/privacy', publicController.privacy);

module.exports = router;
