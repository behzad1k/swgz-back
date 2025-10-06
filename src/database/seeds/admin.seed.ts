import { dataSource } from '../../config/typeorm.config';
import { User, UserRole, SubscriptionPlan } from '../../modules/users/entities/user.entity';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

async function createSuperAdmin() {
  await dataSource.initialize();

  const userRepository = dataSource.getRepository(User);

  const existingAdmin = await userRepository.findOne({
    where: { email: 'bhzd1k@swgz.com' },
  });

  if (existingAdmin) {
    console.log('Super admin already exists');
    await dataSource.destroy();
    return;
  }

  const hashedPassword = await bcrypt.hash('sogol420', 10);

  const admin = userRepository.create({
    email: 'bhzd1k@swgz.com',
    password: hashedPassword,
    role: UserRole.ADMIN,
    subscriptionPlan: SubscriptionPlan.PREMIUM,
    isEmailConfirmed: true,
    apiKey: uuidv4(),
  });

  await userRepository.save(admin);

  console.log('=================================');
  console.log('Super Admin Created Successfully');
  console.log('=================================');
  console.log('Email: bhzd1k@swgz.com');
  console.log('Password: Sogol420');
  console.log('API Key:', admin.apiKey);
  console.log('=================================');
  console.log('IMPORTANT: Change this password immediately after first login!');
  console.log('=================================');

  await dataSource.destroy();
}

createSuperAdmin().catch((error) => {
  console.error('Error creating super admin:', error);
  process.exit(1);
});