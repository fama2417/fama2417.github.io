import { AppShell } from "@/components/AppShell";
import { todayAppointments } from "@/features/appointments/mock-data";
import { appointmentStatusLabels } from "@/features/appointments/status";

export default function AgendaPage() {
  return (
    <AppShell>
      <div className="page-header">
        <div>
          <p className="eyebrow">Hito 3 preparado</p>
          <h2>Agenda diaria</h2>
          <p>Vista inicial con datos de prueba para validar flujo, estados y diseño operativo.</p>
        </div>
        <button className="button primary" type="button">Nueva cita</button>
      </div>

      <section className="toolbar" aria-label="Filtros de agenda">
        <label>
          Fecha
          <input type="date" defaultValue="2026-07-02" />
        </label>
        <label>
          Profesional
          <select defaultValue="all">
            <option value="all">Todos</option>
            <option value="imagenologia">Dra. Imagenología</option>
            <option value="radiologia">Dr. Radiología</option>
          </select>
        </label>
        <label>
          Ubicación
          <select defaultValue="all">
            <option value="all">Todas</option>
            <option value="box-1">Box 1</option>
            <option value="rx">Sala RX</option>
          </select>
        </label>
      </section>

      <section className="schedule-list">
        {todayAppointments.map((appointment) => (
          <article className="appointment-card" key={appointment.id}>
            <div className="time-block">
              <strong>{appointment.startTime}</strong>
              <span>{appointment.endTime}</span>
            </div>
            <div>
              <h3>{appointment.patientName}</h3>
              <p>{appointment.reason}</p>
              <span>{appointment.practitionerName} · {appointment.locationName}</span>
            </div>
            <span className={`status status-${appointment.status}`}>
              {appointmentStatusLabels[appointment.status]}
            </span>
          </article>
        ))}
      </section>
    </AppShell>
  );
}
