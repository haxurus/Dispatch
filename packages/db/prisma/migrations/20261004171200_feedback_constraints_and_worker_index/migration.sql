CREATE INDEX "Ticket_status_id_idx" ON "Ticket"("status", "id");

ALTER TABLE "TicketFeedback"
ADD CONSTRAINT "TicketFeedback_rating_check"
CHECK ("rating" BETWEEN 1 AND 5);
