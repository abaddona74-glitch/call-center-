-- Fake but realistic data. Operator names are placeholders, not real people.
USE asterisk;
INSERT INTO users (extension, name) VALUES
  ('101', 'Operator 101'), ('103', 'Operator 103'), ('106', 'Operator 106'),
  ('111', 'Operator 111'), ('114', 'Operator 114'), ('119', 'Operator 119'),
  ('120', 'Operator 120'), ('200', 'Operator 200'), ('201', 'Operator 201');

USE asteriskcdrdb;
-- Inbound via queue, answered by 101 (client hung up later)
INSERT INTO cdr (calldate, clid, src, dst, dcontext, channel, dstchannel, lastapp, lastdata, duration, billsec, disposition, uniqueid, linkedid, recordingfile, did) VALUES
  (NOW() - INTERVAL 50 MINUTE, '"901234567" <901234567>', '901234567', '200', 'ext-queues', 'SIP/712020159-00000001', 'Local/101@from-queue-00000001;1', 'Queue', '200,t', 185, 160, 'ANSWERED', '1763370000.1', '1763370000.1', 'q-200-901234567-20261117-100000-1763370000.1.wav', '712020159'),
-- Inbound abandoned in queue
  (NOW() - INTERVAL 40 MINUTE, '"935551122" <935551122>', '935551122', '200', 'ext-queues', 'SIP/712020159-00000002', '', 'Queue', '200,t', 42, 0, 'NO ANSWER', '1763370600.2', '1763370600.2', '', '712020159'),
-- Outbound from 103 to a client, answered
  (NOW() - INTERVAL 30 MINUTE, '"Operator 103" <103>', '103', '935551122', 'from-internal', 'SIP/103-00000003', 'SIP/712020159-00000004', 'Dial', 'SIP/712020159/935551122', 95, 80, 'ANSWERED', '1763371200.3', '1763371200.3', 'out-935551122-103-20261117-102000-1763371200.3.wav', ''),
-- Inbound outside of working hours (IVR only)
  (DATE(NOW()) + INTERVAL 22 HOUR - INTERVAL 1 DAY, '"977778899" <977778899>', '977778899', 's', 'ivr-4', 'SIP/712020159-00000005', '', 'Playback', 'non-working', 12, 12, 'ANSWERED', '1763330000.5', '1763330000.5', '', '712020159');
