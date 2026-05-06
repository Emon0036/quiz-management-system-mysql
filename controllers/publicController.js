const Quiz = require('../models/Quiz');

exports.home = async (req, res) => {
  const featuredQuizzes = await Quiz.find({ status: 'published' }).sort('-createdAt').limit(6).populate('createdBy', 'name');
  res.render('home', { title: 'Online Quiz Management System', featuredQuizzes });
}; 

exports.about = (req, res) => res.render('about', { title: 'About' });
exports.features = (req, res) => res.render('features', { title: 'Features' });
exports.pricing = (req, res) => res.render('pricing', { title: 'Pricing' });
exports.help = (req, res) => res.render('help', { title: 'Help Center' });
exports.contact = (req, res) => res.render('contact', { title: 'Contact' });
exports.terms = (req, res) => res.render('terms', { title: 'Terms of Service' });
exports.privacy = (req, res) => res.render('privacy', { title: 'Privacy Policy' });
