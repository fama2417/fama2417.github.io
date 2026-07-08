-- DICOM PS3.16 CID 29/34: modalidades de adquisición admitidas por la MWL.
alter table public.appointments drop constraint appointments_modality_check;
alter table public.appointments add constraint appointments_modality_check check (modality in (
  'OT','AR','BI','BMD','CR','CT','CFM','DMS','DG','DX','ES','XC','GM','IO','IVOCT','IVUS','KER','LS','LEN','MR','MG','NM',
  'OAM','OPM','OP','OPT','OPTBSV','OPTENF','OPV','OCT','OSS','PX','PA','PT','RF','RG','RTIMAGE','SM','SRF','TG','US','BDUS','VA','XA',
  'EPS','ECG','EEG','EMG','EOG','HD','POS','RESP'
));
