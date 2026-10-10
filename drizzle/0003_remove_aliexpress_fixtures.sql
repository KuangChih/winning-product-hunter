-- AliExpress was dropped as a source (ADR-005). Remove its sample (fixture) data; snapshots
-- cascade. Products left without evidence are kept and simply re-scored on the next run.
DELETE FROM "source_items" WHERE "source" = 'aliexpress' AND "provider" = 'fixture';
