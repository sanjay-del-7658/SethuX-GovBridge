/**
 * NOTIFICATION SERVICE — Event-Driven Notifications
 *
 * GovBridge pushes an event here (a webhook call) the moment a
 * transaction reaches a terminal state — it does NOT wait to be
 * polled. This service represents whatever a real deployment would
 * plug in here (SMS gateway, email service, push notifications) —
 * for the prototype it logs the event and stores it so the dashboard
 * can show citizens/officials a live notification feed.
 */

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.NOTIFICATION_PORT || 4003;

const notifications = []; // in-memory event log

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "Notification Service" });
});

/**
 * GovBridge calls this after every transaction that reaches a
 * terminal state (SUCCESS or a failure). This is the "event" in
 * event-driven — GovBridge doesn't know or care who's listening,
 * it just publishes.
 */
app.post("/api/notify", (req, res) => {
  const { traceId, recordId, status, message } = req.body || {};

  if (!traceId || !status) {
    return res.status(400).json({ error: "traceId and status are required" });
  }

  const notification = {
    id: notifications.length + 1,
    traceId,
    recordId: recordId || null,
    status,
    message: message || `Application ${recordId || ""} status: ${status}`,
    receivedAt: new Date().toISOString().replace("T", " ").slice(0, 19),
  };

  notifications.push(notification);

  // Simulated dispatch — a real system would call an SMS/email/push
  // provider here. Logging stands in for that for the prototype.
  console.log(`[Notification] -> ${notification.recordId || "unknown"}: ${notification.message}`);

  res.status(201).json({ message: "Notification received and dispatched", notification });
});

app.get("/api/notifications", (req, res) => {
  const limit = Number(req.query.limit) || 20;
  res.json({ notifications: notifications.slice(-limit).reverse() });
});

app.listen(PORT, () => {
  console.log(`[Notification Service] running on http://localhost:${PORT}`);
});
