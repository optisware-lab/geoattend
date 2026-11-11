const router = require('express').Router();
const institutionController = require('../controllers/institutionController');
const { authenticate, requireAdmin, requireSuperAdmin } = require('../middleware/auth');
const { requireActiveSubscription } = require('../middleware/subscription');
const { auditMiddleware } = require('../middleware/audit');

router.use(authenticate);

router.get('/subscription', institutionController.getSubscriptionStatus);
router.get('/subscription/plans', requireAdmin, institutionController.getSubscriptionPlans);
router.post('/subscription/activate', requireAdmin, institutionController.activateSubscription);

router.use(requireActiveSubscription);

router.get('/current', institutionController.getInstitution);
router.put('/current', requireAdmin, institutionController.updateInstitution);
router.get('/qr-code', requireAdmin, institutionController.getInstitutionQR);
router.get('/rules', institutionController.getAttendanceRules);
router.put('/rules', requireAdmin, institutionController.updateAttendanceRules);
router.get('/staff-ids', requireAdmin, institutionController.getStaffIdSettings);
router.put('/staff-ids', requireAdmin, auditMiddleware('renumber_staff_ids', 'institution'), institutionController.updateStaffIdSettings);

// Super admin only
router.get('/', requireSuperAdmin, institutionController.getAllInstitutions);
router.post('/', requireSuperAdmin, institutionController.createInstitution);
router.delete('/:id', requireSuperAdmin, institutionController.deleteInstitution);
router.post('/:id/extend-trial', requireSuperAdmin, institutionController.extendTrial);
router.post('/:id/repair-code',requireSuperAdmin, institutionController.repairInstitutionCode);
router.get('/:id/admin-credentials', requireSuperAdmin, institutionController.getAdminCredentials);
router.post('/:id/admin-credentials', requireSuperAdmin, institutionController.createOrResetAdminCredentials);

module.exports = router;
