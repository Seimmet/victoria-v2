import { PrismaClient, NotificationType, NotificationChannel } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = `${process.env.DATABASE_URL}`;

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter });

const templates = [
  // EMAIL TEMPLATES
  {
    name: 'guest_credentials_email',
    channel: NotificationChannel.EMAIL,
    type: NotificationType.GN,
    subject: 'Your Account Credentials - Victoria Braids & Weaves',
    content: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Welcome to Victoria Braids & Weaves!</h2>
        <p>Hi {name},</p>
        <p>Thank you for booking with us. An account has been created for you to manage your bookings.</p>
        <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p style="margin: 0;"><strong>Email:</strong> {email}</p>
          <p style="margin: 10px 0 0;"><strong>Password:</strong> {password}</p>
        </div>
        <p>You can log in to your dashboard to view your appointment details.</p> 
        <p>Best regards,<br>Victoria Braids Team</p>
      </div>
    `,
    variables: ['name', 'email', 'password', 'depositAmount']
  },
  {
    name: 'booking_confirmation_email',
    channel: NotificationChannel.EMAIL,
    type: NotificationType.BN,
    subject: 'Booking Confirmation - Victoria Braids & Weaves',
    content: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Booking Confirmed!</h2>
        <p>Hi {name},</p>
        <p>Your appointment for <strong>{service}</strong> on <strong>{date} at {time}</strong> has been confirmed.</p>
         <p>We look forward to seeing you!</p>
        <p>Best regards,<br>Victoria Braids Team</p>
      </div>
    `,
    variables: ['name', 'serviceName', 'date', 'time', 'depositAmount']
  },
  {
    name: 'booking_confirmation_email_user',
    channel: NotificationChannel.EMAIL,
    type: NotificationType.BN,
    subject: 'Appointment Confirmation - Victoria Braids & Weaves',
    content: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Appointment Confirmed!</h2>
        <p>Hi {name},</p>
        <p>Your appointment for <strong>{serviceName}</strong> has been scheduled.</p>
        <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p style="margin: 0;"><strong>Date:</strong> {date}</p>
          <p style="margin: 10px 0 0;"><strong>Time:</strong> {time}</p>
        </div>
        <p>Your {depositAmount} booking fee has been received.</p>
        <p>We look forward to seeing you!</p>
        <p>Best regards,<br>Victoria Braids Team</p>
      </div>
    `,
    variables: ['name', 'serviceName', 'date', 'time', 'depositAmount']
  },
  {
    name: 'booking_completion_email',
    channel: NotificationChannel.EMAIL,
    type: NotificationType.BN,
    subject: 'Thank You for Visiting Victoria Braids & Weaves',
    content: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Thank You!</h2>
        <p>Hi {name},</p>
        <p>It was a pleasure having you at the salon today for your <strong>{serviceName}</strong> service.</p>
        <p>We hope you love your new look! If you have any feedback or questions, please don't hesitate to reach out.</p>
        <p>We look forward to seeing you again soon.</p>
        <p>Best regards,<br>Victoria Braids Team</p>
      </div>
    `,
    variables: ['name', 'serviceName']
  },
  {
    name: 'booking_reminder_email',
    channel: NotificationChannel.EMAIL,
    type: NotificationType.AN,
    subject: 'Appointment Reminder - Victoria Braids & Weaves',
    content: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Appointment Reminder</h2>
        <p>Hi {name},</p>
        <p>This is a reminder that you have an appointment for <strong>{serviceName}</strong> coming up tomorrow.</p>
        <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p style="margin: 0;"><strong>Date:</strong> {date}</p>
          <p style="margin: 10px 0 0;"><strong>Time:</strong> {time}</p>
        </div>
        <p>We look forward to seeing you!</p>
        <p>Best regards,<br>Victoria Braids Team</p>
      </div>
    `,
    variables: ['name', 'serviceName', 'date', 'time']
  },
  // SMS TEMPLATES
  {
    name: 'booking_confirmation_sms',
    channel: NotificationChannel.SMS,
    type: NotificationType.BN,
    content: `Hi {name}, your appointment at Victoria Braids is confirmed for {date} at {time}. See you soon!`,
    variables: ['name', 'date', 'time']
  },
  {
    name: 'booking_reminder_sms',
    channel: NotificationChannel.SMS,
    type: NotificationType.AN,
    content: `Hi {name}, reminder: You have an appointment at Victoria Braids tomorrow ({date}) at {time}.`,
    variables: ['name', 'date', 'time']
  },
  {
    name: 'booking_completion_sms',
    channel: NotificationChannel.SMS,
    type: NotificationType.BN,
    content: `Hi {name}, thanks for visiting Victoria Braids! We hope you love your new look.`,
    variables: ['name']
  },
  {
    name: 'birthday_greeting_email',
    channel: NotificationChannel.EMAIL,
    type: NotificationType.BTDN,
    subject: 'Happy Birthday from Victoria Braids! 🎂',
    content: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Happy Birthday, {name}! 🎉</h2>
        <p>We hope you have a fantastic day filled with joy and celebration.</p>
        <p>As a special treat, come in this week for a discount on your next style!</p>
        <p>Best wishes,<br>Victoria Braids Team</p>
      </div>
    `,
    variables: ['name']
  },
  {
    name: 'birthday_greeting_sms',
    channel: NotificationChannel.SMS,
    type: NotificationType.BTDN,
    content: `Happy Birthday {name}! 🎉 Wishing you a wonderful day from everyone at Victoria Braids!`,
    variables: ['name']
  },
  {
    name: 'easter_greeting_email',
    channel: NotificationChannel.EMAIL,
    type: NotificationType.EN,
    subject: 'Happy Easter from Victoria Braids! 🐰',
    content: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Happy Easter, {name}! 🐰</h2>
        <p>Wishing you a wonderful holiday filled with joy, happiness, and new beginnings.</p>
        <p>Thank you for being a valued client!</p>
        <p>Best wishes,<br>Victoria Braids Team</p>
      </div>
    `,
    variables: ['name']
  },
  {
    name: 'easter_greeting_sms',
    channel: NotificationChannel.SMS,
    type: NotificationType.EN,
    content: `Happy Easter {name}! 🐰 Wishing you a wonderful holiday from Victoria Braids!`,
    variables: ['name']
  }
];

async function main() {
  console.log('Seeding notification templates...');
  
  for (const template of templates) {
    await prisma.notificationTemplate.upsert({
      where: { name: template.name },
      update: {
        channel: template.channel,
        type: template.type,
        subject: template.subject,
        content: template.content,
        variables: template.variables,
      },
      create: {
        name: template.name,
        channel: template.channel,
        type: template.type,
        subject: template.subject,
        content: template.content,
        variables: template.variables,
      },
    });
  }
  
  console.log('Templates seeded successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
