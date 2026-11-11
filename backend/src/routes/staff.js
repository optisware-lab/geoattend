const router = require('express').Router();
const staffController = require('../controllers/staffController');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { auditMiddleware } = require('../middleware/audit');
const { requireActiveSubscription } = require('../middleware/subscription');

router.use(authenticate, requireActiveSubscription, requireAdmin);

router.get('/', staffController.getAllStaff);
router.get('/departments', staffController.getDepartments);
router.get('/next-id', staffController.getNextStaffId);
router.get('/:id', staffController.getStaffById);
router.post('/', auditMiddleware('create_staff', 'staff'), staffController.createStaff);
router.post('/bulk-import', auditMiddleware('bulk_import', 'staff'), staffController.bulkImport);
router.put('/:id', auditMiddleware('update_staff', 'staff'), staffController.updateStaff);
router.put('/:id/reset-password', auditMiddleware('reset_password', 'staff'), staffController.resetPassword);
router.get('/:id/qr-code', staffController.getStaffQRCode);
router.delete('/:id', auditMiddleware('delete_staff', 'staff'), staffController.deleteStaff);

module.exports = router;
