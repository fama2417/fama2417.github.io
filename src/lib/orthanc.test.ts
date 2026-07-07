import assert from "node:assert/strict";
import test from "node:test";
import { dicomTimeRange, mapOrthancStudy } from "./orthanc.ts";

test("normaliza los datos mínimos de un estudio Orthanc", () => {
  const study = mapOrthancStudy({ ID: "orthanc", MainDicomTags: { StudyInstanceUID: "1.2.3", StudyDate: "20260706", StudyTime: "235900", ModalitiesInStudy: "CT\\SR", InstitutionName: "Cliente A", AccessionNumber: "ACC-1" }, PatientMainDicomTags: { PatientName: "PEREZ^ANA", PatientID: "123" } });
  assert.deepEqual([study.patientName, study.patientId, study.date, study.modality, study.institution, study.accessionNumber], ["PEREZ ANA", "123", "2026-07-06", "CT", "Cliente A", "ACC-1"]);
  assert.deepEqual(dicomTimeRange("093000"), ["09:30", "10:00"]);
  assert.deepEqual(dicomTimeRange("235900"), ["23:29", "23:59"]);
});
