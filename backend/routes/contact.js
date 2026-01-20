const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');

// Email transporter configuration for Titan Mail
const transporter = nodemailer.createTransport({
  host: 'smtp.titan.email',
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER || 'support@rvslogistics.com',
    pass: process.env.EMAIL_PASS // Du skal tilføje denne i Render environment variables
  }
});

// Contact form endpoint
router.post('/', async (req, res) => {
  try {
    const { name, email, subject, trackingNumber, message } = req.body;

    // Validate required fields
    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Name, email and message are required' });
    }

    // Email template matching RVS Logistics design
    const htmlTemplate = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #29ABE2 0%, #0d234b 100%); padding: 40px 40px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700;">RVS Logistics</h1>
              <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0; font-size: 14px;">New Contact Form Submission</p>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              
              <!-- Customer Info Box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f0f8fc; border-radius: 8px; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 24px;">
                    <h2 style="color: #0d234b; margin: 0 0 16px; font-size: 18px; font-weight: 600;">Customer Information</h2>
                    
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">
                          <span style="color: #666; font-size: 13px;">Name</span><br>
                          <span style="color: #0d234b; font-size: 15px; font-weight: 600;">${name}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">
                          <span style="color: #666; font-size: 13px;">Email</span><br>
                          <a href="mailto:${email}" style="color: #29ABE2; font-size: 15px; font-weight: 600; text-decoration: none;">${email}</a>
                        </td>
                      </tr>
                      ${subject ? `
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">
                          <span style="color: #666; font-size: 13px;">Subject</span><br>
                          <span style="color: #0d234b; font-size: 15px; font-weight: 600;">${subject}</span>
                        </td>
                      </tr>
                      ` : ''}
                      ${trackingNumber ? `
                      <tr>
                        <td style="padding: 8px 0;">
                          <span style="color: #666; font-size: 13px;">Tracking Number</span><br>
                          <span style="color: #0d234b; font-size: 15px; font-weight: 600; font-family: 'Courier New', monospace;">${trackingNumber}</span>
                        </td>
                      </tr>
                      ` : ''}
                    </table>
                  </td>
                </tr>
              </table>
              
              <!-- Message Box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border: 2px solid #e0e0e0; border-radius: 8px;">
                <tr>
                  <td style="padding: 24px;">
                    <h2 style="color: #0d234b; margin: 0 0 16px; font-size: 18px; font-weight: 600;">Message</h2>
                    <p style="color: #333; font-size: 15px; line-height: 1.7; margin: 0; white-space: pre-wrap;">${message}</p>
                  </td>
                </tr>
              </table>
              
              <!-- Reply Button -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 24px;">
                <tr>
                  <td align="center">
                    <a href="mailto:${email}?subject=Re: ${subject || 'Your inquiry'} - RVS Logistics" style="display: inline-block; background-color: #29ABE2; color: #ffffff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">Reply to Customer</a>
                  </td>
                </tr>
              </table>
              
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #0d234b; padding: 30px 40px; text-align: center;">
              <p style="color: rgba(255,255,255,0.8); margin: 0 0 8px; font-size: 14px;">RVS Logistics - Professional Freight & Delivery</p>
              <p style="color: rgba(255,255,255,0.6); margin: 0; font-size: 12px;">© 2025 RVS Logistics. All rights reserved.</p>
            </td>
          </tr>
          
        </table>
        
        <!-- Timestamp -->
        <p style="color: #999; font-size: 12px; margin-top: 20px;">Received: ${new Date().toLocaleString('en-GB', { timeZone: 'Europe/Copenhagen' })} (CET)</p>
        
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    // Send email to support
    await transporter.sendMail({
      from: '"RVS Logistics" <support@rvslogistics.com>',
      to: 'support@rvslogistics.com',
      replyTo: email,
      subject: `New Contact: ${subject || 'General Inquiry'} - ${name}`,
      html: htmlTemplate
    });

    // Send confirmation email to customer
    const customerTemplate = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #29ABE2 0%, #0d234b 100%); padding: 40px 40px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700;">RVS Logistics</h1>
              <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0; font-size: 14px;">Thank you for contacting us</p>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <h2 style="color: #0d234b; margin: 0 0 20px; font-size: 22px; font-weight: 600;">Hello ${name},</h2>
              
              <p style="color: #333; font-size: 15px; line-height: 1.7; margin: 0 0 20px;">Thank you for reaching out to RVS Logistics. We have received your message and our support team will get back to you within 24 hours.</p>
              
              <!-- Summary Box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f0f8fc; border-radius: 8px; margin: 24px 0;">
                <tr>
                  <td style="padding: 24px;">
                    <h3 style="color: #0d234b; margin: 0 0 12px; font-size: 16px; font-weight: 600;">Your Message Summary</h3>
                    ${subject ? `<p style="color: #666; font-size: 14px; margin: 0 0 8px;"><strong>Subject:</strong> ${subject}</p>` : ''}
                    ${trackingNumber ? `<p style="color: #666; font-size: 14px; margin: 0 0 8px;"><strong>Tracking Number:</strong> ${trackingNumber}</p>` : ''}
                    <p style="color: #666; font-size: 14px; margin: 0;"><strong>Message:</strong> ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}</p>
                  </td>
                </tr>
              </table>
              
              <p style="color: #333; font-size: 15px; line-height: 1.7; margin: 0 0 20px;">In the meantime, you can track your shipment on our website:</p>
              
              <!-- Track Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="https://rvslogistics.com" style="display: inline-block; background-color: #29ABE2; color: #ffffff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">Track Your Shipment</a>
                  </td>
                </tr>
              </table>
              
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #0d234b; padding: 30px 40px; text-align: center;">
              <p style="color: rgba(255,255,255,0.8); margin: 0 0 8px; font-size: 14px;">RVS Logistics - Professional Freight & Delivery</p>
              <p style="color: rgba(255,255,255,0.6); margin: 0 0 12px; font-size: 12px;">Mon-Fri: 9:00-17:00 CET</p>
              <p style="color: rgba(255,255,255,0.6); margin: 0; font-size: 12px;">© 2025 RVS Logistics. All rights reserved.</p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    await transporter.sendMail({
      from: '"RVS Logistics" <support@rvslogistics.com>',
      to: email,
      subject: 'Thank you for contacting RVS Logistics',
      html: customerTemplate
    });

    res.json({ success: true, message: 'Message sent successfully' });

  } catch (error) {
    console.error('Contact form error:', error);
    res.status(500).json({ error: 'Failed to send message. Please try again.' });
  }
});

module.exports = router;
