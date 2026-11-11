-- Backfill: credit the 15 receipt-backfill expenses (10/13/26) to the tech who emailed each receipt
-- to const.receipt.rp@gmail.com instead of Trae. Evidence = the matching email in that mailbox.
begin;
-- 2026-08-31 $27.0 SDS Max 1" x 16" flat chisel (O15)  <=  175.36 HDP O15 concrete drillbit, and two extension cords (Sep 1)
update public.expenses set submitted_by='29568682-28bb-4545-b365-bc907f278c30', submitter_name='Tristin Dondero', submitter_email='tristindondero.rp@gmail.com' where id='16f7dbbf-911c-4034-889a-3b369d6f6473';
update public.asset_tool_items set submitter_name='Tristin Dondero', submitter_email='tristindondero.rp@gmail.com' where id='c853877d-30fa-48b1-8ba9-62d46fa566a4';
-- 2026-08-31 $148.36 Husky 14/3 x 100 ft extension cord (O15)  <=  175.36 HDP O15 concrete drillbit, and two extension cords (Sep 1)
update public.expenses set submitted_by='29568682-28bb-4545-b365-bc907f278c30', submitter_name='Tristin Dondero', submitter_email='tristindondero.rp@gmail.com' where id='4c0397dd-9486-45cf-93ba-9831f7977460';
update public.asset_tool_items set submitter_name='Tristin Dondero', submitter_email='tristindondero.rp@gmail.com' where id='83bf59a6-0b86-4511-9e7d-89729f2cc2c5';
-- 2026-08-31 $70.72 3/8 in hex nuts, fender washers (100 ea), carriage bolts (A1  <=  70.72 HDP EL TRUCK 3/8 hex nuts n washers (Sep 1)
update public.expenses set submitted_by='29568682-28bb-4545-b365-bc907f278c30', submitter_name='Tristin Dondero', submitter_email='tristindondero.rp@gmail.com' where id='cfc01985-1ded-4dfd-8527-6057ff40cf98';
update public.asset_tool_items set submitter_name='Tristin Dondero', submitter_email='tristindondero.rp@gmail.com' where id='5de0c06d-32e2-4114-94a2-da1011a8c7af';
-- 2026-08-31 $10.99 Phone charger (receipt shows only "Dept 1"; email says phone  <=  10.99 TEC E5 phone charger (Aug 31)
update public.expenses set submitted_by='73eadd77-4c10-423b-b55c-397acbe3ed75', submitter_name='Jesse Franks', submitter_email='jessefranks.rp@gmail.com' where id='8694fd26-7205-4372-89d9-cac7b3b4f684';
update public.asset_tool_items set submitter_name='Jesse Franks', submitter_email='jessefranks.rp@gmail.com' where id='72d4f6e0-54db-4f66-92a1-00241bd74c8b';
-- 2026-09-01 $23.51 Offset straight-cut snips 9-4/5 in (O15)  <=  47.02 HDP O15 & EL TRUCK 2 pair metal cutters (Sep 1)
update public.expenses set submitted_by='29568682-28bb-4545-b365-bc907f278c30', submitter_name='Tristin Dondero', submitter_email='tristindondero.rp@gmail.com' where id='b2e1f31b-316b-44c7-a724-911d2afdf24d';
update public.asset_tool_items set submitter_name='Tristin Dondero', submitter_email='tristindondero.rp@gmail.com' where id='d833dbf7-2694-44f8-94d9-12d92df090de';
-- 2026-09-01 $23.51 Offset straight-cut snips 9-4/5 in (A1)  <=  47.02 HDP O15 & EL TRUCK 2 pair metal cutters (Sep 1)
update public.expenses set submitted_by='29568682-28bb-4545-b365-bc907f278c30', submitter_name='Tristin Dondero', submitter_email='tristindondero.rp@gmail.com' where id='be7acb60-16a4-4748-9cd5-44a915e4afc2';
update public.asset_tool_items set submitter_name='Tristin Dondero', submitter_email='tristindondero.rp@gmail.com' where id='56391126-9caf-4efe-b585-a490086be31c';
-- 2026-09-01 $21.05 2.5 x Prime Guard DEF 2.5 gal (E5)  <=  21.05 TEC E5 (Sep 2)
update public.expenses set submitted_by='73eadd77-4c10-423b-b55c-397acbe3ed75', submitter_name='Jesse Franks', submitter_email='jessefranks.rp@gmail.com' where id='9a7e699e-4290-4bf7-81f2-2f8907d2b255';
update public.asset_tool_items set submitter_name='Jesse Franks', submitter_email='jessefranks.rp@gmail.com' where id='ac0edd2f-8204-401c-96e2-ec351dcafac6';
-- 2026-09-02 $282.86 Dremel 8250 12V rotary tool + flex shaft, 130-pc kit, carvin  <=  306.16 HDP EL TRUCK DREMEL KIT (Sep 2)
update public.expenses set submitted_by='29568682-28bb-4545-b365-bc907f278c30', submitter_name='Tristin Dondero', submitter_email='tristindondero.rp@gmail.com' where id='297cd74a-98a4-4206-93c4-26168d159753';
update public.asset_tool_items set submitter_name='Tristin Dondero', submitter_email='tristindondero.rp@gmail.com' where id='9ccebbb2-eff9-4463-9191-3dfed3f01ea4';
-- 2026-09-02 $23.3 Klean-Strip acetone, 1 gal (A1)  <=  306.16 HDP EL TRUCK DREMEL KIT (Sep 2)
update public.expenses set submitted_by='29568682-28bb-4545-b365-bc907f278c30', submitter_name='Tristin Dondero', submitter_email='tristindondero.rp@gmail.com' where id='8d1ccaf4-5d70-4a7f-b685-795cc0fb9686';
update public.asset_tool_items set submitter_name='Tristin Dondero', submitter_email='tristindondero.rp@gmail.com' where id='a15e1cf3-cf91-4432-974a-73daa1df07f1';
-- 2026-09-03 $19.45 2 x Utility knives (KT 10-pc HD, OLFA 18 mm snap-off) (O15)  <=  142.85 TEC O15 sanding tools utility knife's (Sep 3)
update public.expenses set submitted_by='29568682-28bb-4545-b365-bc907f278c30', submitter_name='Tristin Dondero', submitter_email='tristindondero.rp@gmail.com' where id='5b4ce188-1895-4a2d-877c-5e1fca4a91b6';
update public.asset_tool_items set submitter_name='Tristin Dondero', submitter_email='tristindondero.rp@gmail.com' where id='ea1672ea-17fe-4b21-9a56-5699fb4af7e3';
-- 2026-09-03 $37.84 3 x Utility blades 10-pk, OLFA 9 mm snap blades, oscillating  <=  142.85 TEC O15 sanding tools utility knife's (Sep 3)
update public.expenses set submitted_by='29568682-28bb-4545-b365-bc907f278c30', submitter_name='Tristin Dondero', submitter_email='tristindondero.rp@gmail.com' where id='05b77e5a-db90-428d-ad79-4e31e23e2c59';
update public.asset_tool_items set submitter_name='Tristin Dondero', submitter_email='tristindondero.rp@gmail.com' where id='9d52b402-2fc4-42d4-96e0-d04206faf848';
-- 2026-09-03 $42.05 3 x Wire brush attachment, grout-out blade, 4.5 in paint & r  <=  142.85 TEC O15 sanding tools utility knife's (Sep 3)
update public.expenses set submitted_by='29568682-28bb-4545-b365-bc907f278c30', submitter_name='Tristin Dondero', submitter_email='tristindondero.rp@gmail.com' where id='5459622a-75fc-4d89-af5a-449cdb8a594e';
update public.asset_tool_items set submitter_name='Tristin Dondero', submitter_email='tristindondero.rp@gmail.com' where id='a8790bbe-4667-473c-99ed-5ab16c5961d2';
-- 2026-09-03 $43.51 4 x Scrapers (glass + multi-blade) and 1/4 in screwdrivers (  <=  142.85 TEC O15 sanding tools utility knife's (Sep 3)
update public.expenses set submitted_by='29568682-28bb-4545-b365-bc907f278c30', submitter_name='Tristin Dondero', submitter_email='tristindondero.rp@gmail.com' where id='31f2651d-f2a1-49f2-ae09-a1c63e8e2461';
update public.asset_tool_items set submitter_name='Tristin Dondero', submitter_email='tristindondero.rp@gmail.com' where id='37256b42-8bcf-4e59-a471-919db3b84d5a';
-- 2026-09-04 $20.0 2.5 x Sheetz 2.5 gal DEF (N14)  <=  20.00 TEC SHEETZ DEF FLUID N14 (Sep 4)
update public.expenses set submitted_by='47abca7f-2317-430e-af2e-04e9c57e1245', submitter_name='Matthew Breen', submitter_email='mbreen.rp@gmail.com' where id='9d36e11c-9b8d-4620-ba48-f42efe6ca2b7';
update public.asset_tool_items set submitter_name='Matthew Breen', submitter_email='mbreen.rp@gmail.com' where id='4b5029aa-beff-4a5a-9b16-82346fc08c39';
-- 2026-09-08 $68.87 3 x USB-C cable, Lightning cable, 2-port PD car charger (E5)  <=  68.87 TEC E5 phone charger (Sep 8)
update public.expenses set submitted_by='73eadd77-4c10-423b-b55c-397acbe3ed75', submitter_name='Jesse Franks', submitter_email='jessefranks.rp@gmail.com' where id='b5a884af-4526-410c-8bce-21f7067ac09d';
update public.asset_tool_items set submitter_name='Jesse Franks', submitter_email='jessefranks.rp@gmail.com' where id='d7a0d6f1-50ff-4ad1-9e56-bc1ec5c3939c';
commit;
