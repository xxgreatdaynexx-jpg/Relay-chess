-- REVIEW ONLY. NOT EXECUTED IN PRODUCTION.
-- User: Mayor takes office today; make it happen, it says tomorrow (Nov8 2026 Regina).
-- One-term exception: Sunday Nov8 00:00 Regina; retain Monday Nov16 00:00 end and future Monday cadence.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
LOCK TABLE mayor_candidates, mayor_votes IN SHARE MODE;
LOCK TABLE mayor_terms IN SHARE ROW EXCLUSIVE MODE;
DO $handover$
DECLARE
  t mayor_terms%ROWTYPE;
  ranked jsonb;
BEGIN
  IF timezone('America/Regina', current_timestamp)::date <> DATE '2026-11-08' THEN
    RAISE EXCEPTION 'Stale review: handover authorized for Nov8 Regina only';
  END IF;
  SELECT * INTO STRICT t FROM mayor_terms WHERE week='2026-11-02' FOR UPDATE;
  IF t.player_key <> 'carter2' OR t.name <> 'carter2' OR t.votes <> 3
     OR t.ends_at <> 1794808800000 OR t.removed_at IS NOT NULL
     OR t.vice_key IS DISTINCT FROM 'liam' OR t.vice_name IS DISTINCT FROM 'Liam'
     OR t.vice_votes IS DISTINCT FROM 2 OR NOT t.vice_settled OR t.note IS NOT NULL THEN
    RAISE EXCEPTION 'Term changed since review; abort without mutation';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('key',player_key,'votes',n) ORDER BY n DESC,filed_at,player_key)
    INTO ranked FROM (
      SELECT c.player_key,c.filed_at,count(v.voter_key) n
      FROM mayor_candidates c LEFT JOIN mayor_votes v
      ON v.week=c.week AND v.candidate_key=c.player_key
      WHERE c.week='2026-11-02' GROUP BY c.player_key,c.filed_at
    ) q;
  IF ranked IS DISTINCT FROM '[{"key":"carter2","votes":3},{"key":"liam","votes":2},{"key":"chessguy2","votes":1}]'::jsonb THEN
    RAISE EXCEPTION 'Final election tally changed since review; abort';
  END IF;
  IF EXISTS (SELECT 1 FROM mayor_terms WHERE week<>t.week AND removed_at IS NULL
             AND starts_at<t.ends_at AND ends_at>1794117600000) THEN
    RAISE EXCEPTION 'Another term overlaps early handover; abort';
  END IF;
  IF t.starts_at=1794117600000 THEN RETURN; END IF; -- exact replay is a no-op
  IF t.starts_at<>1794204000000 THEN RAISE EXCEPTION 'Unexpected term start; abort'; END IF;
  UPDATE mayor_terms SET starts_at=1794117600000
  WHERE week='2026-11-02' AND player_key='carter2' AND starts_at=1794204000000;
  IF NOT FOUND THEN RAISE EXCEPTION 'Term changed; abort'; END IF;
END $handover$;
COMMIT;
-- Verify separately with SELECT only. All columns except this single starts_at must be byte-identical.
