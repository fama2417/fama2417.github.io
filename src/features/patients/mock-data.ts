export type Patient = {
  id: string;
  identifier: string;
  name: string;
  birthDate: string;
  sex: "female" | "male" | "other" | "unknown";
  phone: string;
  consentAt?: string;
};

export const patients: Patient[] = [
  {
    id: "pat-001",
    identifier: "RUN 11.111.111-1",
    name: "Paciente de prueba 01",
    birthDate: "1985-04-12",
    sex: "female",
    phone: "+56 9 1111 1111",
  },
  {
    id: "pat-002",
    identifier: "RUN 22.222.222-2",
    name: "Paciente de prueba 02",
    birthDate: "1978-09-03",
    sex: "male",
    phone: "+56 9 2222 2222",
  },
  {
    id: "pat-003",
    identifier: "RUN 33.333.333-3",
    name: "Paciente de prueba 03",
    birthDate: "1990-02-18",
    sex: "unknown",
    phone: "+56 9 3333 3333",
  },
];
