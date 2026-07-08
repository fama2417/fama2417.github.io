// DICOM PS3.16 CID 29 + CID 34: modalidades de adquisición utilizables en MWL.
export const DICOM_MODALITIES = [
  ["AR", "Autorrefracción"], ["BI", "Imagen biomagnética"], ["BMD", "Densitometría ósea"], ["CR", "Radiografía computarizada"],
  ["CT", "Tomografía computarizada"], ["CFM", "Microscopía confocal"], ["DMS", "Dermatoscopía"], ["DG", "Diafanografía"],
  ["DX", "Radiografía digital"], ["ES", "Endoscopía"], ["XC", "Fotografía externa"], ["GM", "Microscopía general"],
  ["IO", "Radiografía intraoral"], ["IVOCT", "OCT intravascular"], ["IVUS", "Ultrasonido intravascular"], ["KER", "Queratometría"],
  ["LS", "Escáner de superficie láser"], ["LEN", "Lensometría"], ["MR", "Resonancia magnética"], ["MG", "Mamografía"],
  ["NM", "Medicina nuclear"], ["OAM", "Medición axial oftálmica"], ["OPM", "Mapeo oftálmico"], ["OP", "Fotografía oftálmica"],
  ["OPT", "Tomografía oftálmica"], ["OPTBSV", "Análisis B-scan oftálmico"], ["OPTENF", "Tomografía oftálmica en face"], ["OPV", "Campo visual"],
  ["OCT", "Tomografía de coherencia óptica"], ["OSS", "Escáner óptico de superficie"], ["PX", "Radiografía panorámica"], ["PA", "Fotoacústica"],
  ["PT", "Tomografía por emisión de positrones"], ["RF", "Radiofluoroscopía"], ["RG", "Radiografía convencional"], ["RTIMAGE", "Imagen de radioterapia"],
  ["SM", "Microscopía de portaobjetos"], ["SRF", "Refracción subjetiva"], ["TG", "Termografía"], ["US", "Ultrasonido"],
  ["BDUS", "Densitometría ósea por ultrasonido"], ["VA", "Agudeza visual"], ["XA", "Angiografía por rayos X"],
  ["EPS", "Electrofisiología cardíaca"], ["ECG", "Electrocardiografía"], ["EEG", "Electroencefalografía"], ["EMG", "Electromiografía"],
  ["EOG", "Electrooculografía"], ["HD", "Hemodinámica"], ["POS", "Sensor de posición"], ["RESP", "Respiratorio"],
] as const;
