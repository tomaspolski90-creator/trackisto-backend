const express = require('express');
const router = express.Router();

// Contact form endpoint using Resend API
router.post('/', async (req, res) => {
  try {
    const { name, email, subject, trackingNumber, message } = req.body;

    console.log('[Contact] Received form submission from:', email);

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

    console.log('[Contact] Sending email via Resend API...');

    // Send email using Resend API - now using verified domain
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'RVS Logistics <noreply@rvslogistics.com>',
        to: 'support@rvslogistics.com',
        reply_to: email,
        subject: `New Contact: ${subject || 'General Inquiry'} - ${name}`,
        html: htmlTemplate
      })
    });

    const resendData = await resendResponse.json();
    
    if (!resendResponse.ok) {
      console.error('[Contact] Resend API error:', resendData);
      throw new Error('Failed to send email');
    }

    console.log('[Contact] Email sent successfully:', resendData.id);

    res.json({ success: true, message: 'Message sent successfully' });

  } catch (error) {
    console.error('[Contact] Form error:', error.message);
    res.status(500).json({ error: 'Failed to send message. Please try again.' });
  }
});

module.exports = router;
