import { AppShell } from "@/components/AppShell";
import { patients } from "@/features/patients/mock-data";

export default function PatientsPage() {
  return (
    <AppShell>
      <div className="page-header">
        <div>
          <p className="eyebrow">Hito 2 preparado</p>
          <h2>Pacientes</h2>
          <p>Registro mínimo para asociar pacientes a citas y evitar duplicados.</p>
        </div>
        <button className="button primary" type="button">Nuevo paciente</button>
      </div>

      <section className="toolbar" aria-label="Búsqueda de pacientes">
        <label className="wide-field">
          Buscar paciente
          <input placeholder="Nombre, apellido o identificador" type="search" />
        </label>
      </section>

      <section className="table-card">
        <table>
          <thead>
            <tr>
              <th>Identificador</th>
              <th>Nombre</th>
              <th>Fecha nacimiento</th>
              <th>Sexo</th>
              <th>Teléfono</th>
            </tr>
          </thead>
          <tbody>
            {patients.map((patient) => (
              <tr key={patient.id}>
                <td>{patient.identifier}</td>
                <td>{patient.name}</td>
                <td>{patient.birthDate}</td>
                <td>{patient.sex}</td>
                <td>{patient.phone}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </AppShell>
  );
}
