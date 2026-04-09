/**
 * email — basic notification stub.
 * No SMTP is configured yet — all notifications are logged to the console.
 * Wire to SendGrid / SES when SMTP_* environment variables are available.
 */

// ---------------------------------------------------------------------------
// sendNotification
// ---------------------------------------------------------------------------

export async function sendNotification(params: {
  to: string[];
  subject: string;
  body: string;
  type: 'success' | 'failure' | 'alert';
}): Promise<void> {
  // TODO: Wire to SendGrid/SES when SMTP_* env vars are set
  // Example integration:
  //   if (process.env.SMTP_HOST) {
  //     await sgMail.send({ to: params.to, subject: params.subject, text: params.body });
  //   }
  console.log('[Email notification]', {
    to: params.to,
    subject: params.subject,
    type: params.type,
    bodyPreview: params.body.slice(0, 200),
  });
}

// ---------------------------------------------------------------------------
// sendWorkflowAlert
// ---------------------------------------------------------------------------

export async function sendWorkflowAlert(params: {
  workflowId: string;
  workflowName: string;
  status: 'success' | 'failure' | 'warning';
  message: string;
  recipients: string[];
}): Promise<void> {
  const subject =
    params.status === 'success'
      ? `[SRIntelligence] Workflow "${params.workflowName}" completed successfully`
      : params.status === 'failure'
      ? `[SRIntelligence] Workflow "${params.workflowName}" failed`
      : `[SRIntelligence] Workflow "${params.workflowName}" warning`;

  const body = [
    `Workflow: ${params.workflowName}`,
    `ID: ${params.workflowId}`,
    `Status: ${params.status.toUpperCase()}`,
    '',
    params.message,
  ].join('\n');

  await sendNotification({
    to: params.recipients,
    subject,
    body,
    type: params.status === 'warning' ? 'alert' : params.status,
  });
}
