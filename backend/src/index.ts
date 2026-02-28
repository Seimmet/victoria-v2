import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import morgan from 'morgan';
import cluster from 'cluster';
import os from 'os';

import authRoutes from './routes/authRoutes';
import stylesRoutes from './routes/stylesRoutes';
import categoryRoutes from './routes/categoryRoutes';
import bookingRoutes from './routes/bookingRoutes';
import availabilityRoutes from './routes/availabilityRoutes';
import stylistRoutes from './routes/stylistRoutes';
import userRoutes from './routes/userRoutes';
import settingsRoutes from './routes/settingsRoutes';
import reportsRoutes from './routes/reportsRoutes';
import chatbotRoutes from './routes/chatbotRoutes';
import notificationRoutes from './routes/notificationRoutes';
import notificationSettingsRoutes from './routes/notificationSettingsRoutes';
import birthdayRoutes from './routes/birthdayRoutes';
import faqRoutes from './routes/faqRoutes';
import bookingPolicyRoutes from './routes/bookingPolicyRoutes';
import galleryRoutes from './routes/galleryRoutes';
import promoRoutes from './routes/promoRoutes';
import cron from 'node-cron';
import { reminderService } from './services/reminderService';
import prisma from './utils/prisma';

dotenv.config();

const PORT = process.env.PORT || 5000;
const ENABLE_REMINDERS = process.env.ENABLE_REMINDERS !== 'false';
const isProduction = process.env.NODE_ENV === 'production';

// Cluster setup for concurrency
if (isProduction && cluster.isPrimary) {
  const numCPUs = os.cpus().length;
  console.log(`Primary ${process.pid} is running`);
  console.log(`Forking ${numCPUs} workers...`);

  // Fork workers.
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died. Restarting...`);
    cluster.fork();
  });
} else {
  const app = express();

  app.set('etag', false);

  app.use(express.json());
  app.use(cors());
  app.use(helmet());
  app.use(morgan('dev'));

  app.use((req, res, next) => {
    const start = Date.now();
    // Increase timeout to 120s for complex availability calculations
    res.setTimeout(120000, () => {
      console.error('Request timed out', req.method, req.originalUrl);
      if (!res.headersSent) {
        res.status(504).json({ message: 'Request timeout' });
      }
    });
    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
    });
    next();
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/styles', stylesRoutes);
  app.use('/api/categories', categoryRoutes);
  app.use('/api/bookings', bookingRoutes);
  app.use('/api/availability', availabilityRoutes);
  app.use('/api/stylists', stylistRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/reports', reportsRoutes);
  app.use('/api/chat', chatbotRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/birthdays', birthdayRoutes);
  app.use('/api/faqs', faqRoutes);
  app.use('/api/booking-policy', bookingPolicyRoutes);
  app.use('/api/gallery', galleryRoutes);
  app.use('/api/promos', promoRoutes);
  app.use('/api/notification-settings', notificationSettingsRoutes);

  app.get('/', (req, res) => {
    res.send(`Victoria Salon API is running on worker ${process.pid}`);
  });

  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Unhandled Error:', err);
    res.status(500).json({
      message: err.message || 'Internal Server Error',
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });
  });

  // Global Error Handlers to prevent crash
  process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION! 💥 Shutting down...');
    console.error(err.name, err.message);
    // In cluster mode, let the master restart us
    process.exit(1);
  });

  process.on('unhandledRejection', (err: any) => {
    console.error('UNHANDLED REJECTION! 💥 Shutting down...');
    console.error(err.name, err.message);
    // In cluster mode, let the master restart us
    process.exit(1);
  });

  const server = app.listen(PORT, async () => {
    console.log(`Worker ${process.pid} started on port ${PORT}`);

    // Only run scheduled tasks on one worker (e.g., the first one or a specific ID)
    // For simplicity in cluster mode, we might want to disable cron in workers and run a dedicated worker,
    // or use a lock. Here, we'll run it only if it's not a cluster or specific worker logic.
    // However, simplest "fix" for concurrency crashes is just to let all workers run and potentially have duplicate checks (idempotent),
    // OR just run cron on worker 1.
    // Given the complexity, let's keep cron basic for now. 
    
    // Better approach: Use a separate process for cron or leader election.
    // For this specific codebase, let's allow all to start but maybe rely on the fact that reminders are idempotent?
    // reminderService.checkAndSendReminders() checks DB state. If updated atomically, it's fine.
    
    if (ENABLE_REMINDERS && (cluster.worker?.id === 1 || !cluster.isWorker)) {
      cron.schedule('0 * * * *', () => {
        console.log(`Worker ${process.pid} running scheduled reminder check...`);
        reminderService.checkAndSendReminders();
      });
    }
    
    // Test DB connection
    try {
        await prisma.$connect();
        console.log(`Worker ${process.pid} connected to database`);
    } catch (e) {
        console.error(`Worker ${process.pid} failed to connect to database`, e);
    }
  });
}
