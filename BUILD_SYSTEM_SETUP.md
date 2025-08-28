# Database Setup for Build System

This app uses a hybrid approach that keeps builds lightweight while preserving the full BOM for editing:

- parts table – Source of truth for manufactured parts
- purchasing table – Source of truth for COTS items
- builds.part_ids – References IDs from parts and purchasing to compute progress/kitting
- build_bom table – Stores the full BOM captured from Onshape as part_type='other' so items can be promoted later

Important note: Do not drop build_bom. It’s used to persist the full BOM and manage “Other Items.”

## Migration order (run in Supabase SQL Editor)

Run these migrations in order:

1) migration_add_build_system.sql
  - Creates build_bom and purchasing tables, adds constraints and indexes, and enables RLS/policies
2) migration_add_other_category.sql
  - Updates build_bom.part_type to allow 'other' and adds an index for faster queries
3) migration_add_drawing_support.sql
  - Adds parts.onshape_drawing_element_id for drawing-to-PDF in manufacturing

Optional / already present:
- migration_minimal.sql and supabase.sql are reference scaffolds (not always required on an existing DB)

Deprecated, do not run:
- migration_fix_builds.sql – This drops build_bom and is no longer applicable to the current architecture

## How the flow works

1. When you create a build from a BOM, the app stores the entire BOM into build_bom as part_type='other' (doesn’t affect progress).
2. From Build Details, you can promote “Other Items” to manufacturing or purchasing.
3. When promoted, the app inserts records into parts/purchasing, and the IDs are added to builds.part_ids.
4. Build progress and kitting are computed strictly from parts/purchasing via part_ids, not from build_bom.

## Quick test

- Visit a CAD subsystem and create a build from a version/BOM
- Open Build Details and verify the “Other Items” list
- Promote one item to manufacturing and one to purchasing
- Check that build progress now reflects those promoted items only
