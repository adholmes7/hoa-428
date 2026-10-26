import { Link } from 'react-router-dom'

const S = ({ id }: { id: string }) => <Link to={`/ccrs/${id.replace(/\(.*$/, '')}`}>§{id}</Link>

// [duty, CC&R sections, extra citation]
const DUTIES: [string, string[], string?][] = [
  ['Maintain the Common Area and structure, including pipes “wherever located”', ['3.7', '6.3(c)']],
  ['Repair utility lines damaged by wear and tear, as a common expense', ['2.7(d)']],
  ['Keep separate operating and adequate reserve funds', ['4.3']],
  ['Get owner approval for increases over 20% or special assessments over 5% of the budget (except emergencies)', ['4.9']],
  ['Give 30–60 days’ notice of assessment increases', ['4.10']],
  ['Carry full replacement-value property, $2M liability, and D&O insurance', ['8.1', '8.2', '8.3']],
  ['Notify all members immediately if required insurance can’t be obtained', ['8.5']],
  ['Hold insurance proceeds as trustee and use them for repairs', ['8.6']],
  ['Pay the deductible for Common Area items', ['8.9']],
  ['Make records available for inspection', ['3.10'], 'Civ. Code §5200'],
  ['Adopt rules only after 30-day notice and comment', ['3.8']],
  ['Decide architectural requests in writing within 60 days', ['7.3']],
  ['Answer lease requests within 10 days', ['5.3']],
  ['Meet and confer when an owner asks; it may not refuse', ['12.5']],
  ['Give 48 hours’ notice before entering a unit (except emergencies)', ['3.5']],
]

export default function Responsibilities() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Who is responsible?</h1>
          <p>A plain-language reading of the CC&Rs. Not legal advice. Check the linked sections, and talk to an HOA attorney before relying on it.</p>
        </div>
      </div>

      <div className="card">
        <h2>Where your unit ends</h2>
        <p>
          Your unit is bounded by the <b>interior surfaces</b> of its perimeter walls, floors and ceilings (<S id="1.25" />). Wall cavities, the
          subfloor and the floor structure between units are <b>Common Area</b>, owned 1/22 by each owner (<S id="2.2" />).
        </p>
      </div>

      <div className="card">
        <h2>Water leaks: who fixes and who pays</h2>
        <div className="table-wrap">
          <table className="list matrix">
            <thead>
              <tr><th>Where the leak comes from</th><th>Fixing the source</th><th>Your unit’s interior</th><th>A neighbor’s interior</th></tr>
            </thead>
            <tbody>
              <tr>
                <td><b>An owner’s fixture or appliance</b> (sink, dishwasher, washer, water heater)</td>
                <td>That owner (<S id="6.3(a)" />)</td>
                <td>Each owner for their own interior (<S id="6.6(a)" />)</td>
                <td>The owner whose fixture leaked may be liable (<S id="6.5" />, <S id="6.6(d)" />)</td>
              </tr>
              <tr>
                <td><b>A common pipe in a wall, floor or ceiling</b>, including one serving a single unit</td>
                <td><b>The HOA, as a common expense</b> (<S id="6.3(c)" />, <S id="2.7(d)" />)</td>
                <td>Each owner, usually through their HO-6 policy (<S id="6.6(a)" />)</td>
                <td>Each owner (<S id="6.6(a)" />)</td>
              </tr>
              <tr>
                <td><b>Roof, window or exterior</b></td>
                <td>The HOA (<S id="6.3(c)" />); windows and glass doors are the owner’s (<S id="6.3(b)" />)</td>
                <td>Each owner; check whether the HOA master policy responds</td>
                <td>Each owner</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt">
          <b>The HOA’s liability cap.</b> The Association isn’t liable for water damage to units beyond the insurance proceeds it recovers,
          “if any,” unless the Board was <b>grossly negligent</b> (<S id="6.6(b)" />, <S id="3.11" />). If the Board never files a claim, there
          are no proceeds, so a dated written record of what the Board knew, and when, matters.
        </p>
        <p>
          <b>Deductibles.</b> Owners pay the deductible for owner items; the HOA pays it for Common Area items; a negligent owner pays
          regardless (<S id="8.9" />).
        </p>
        <p style={{ marginBottom: 0 }}>
          <b>Insurance.</b> Every owner must carry property and liability insurance (<S id="8.7" />). The HOA has no duty to check, and isn’t
          responsible to an uninsured owner for damage to their unit.
        </p>
      </div>

      <div className="card">
        <h2>Floors and remodeling</h2>
        <p>
          Above the first floor, carpet is required except in kitchens, laundry areas and bathrooms. <b>Any</b> floor-covering replacement,
          including underlayment, needs the Board’s prior written approval, and the review is about sound transfer (<S id="5.4" />). The Board
          has 60 days or the request is <b>deemed denied</b> (<S id="7.3" />). Submit by personal delivery or certified mail to the Secretary.
        </p>
        <Link className="btn" to="/requests/new?type=architectural">Request flooring approval</Link>
      </div>

      <div className="card">
        <h2>What the Board must do</h2>
        <div className="table-wrap">
          <table className="list">
            <tbody>
              {DUTIES.map(([d, ids, extra]) => (
                <tr key={d}>
                  <td>{d}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {ids.map((id, i) => (
                      <span key={id}>{i > 0 && ', '}<S id={id} /></span>
                    ))}
                    {extra && `; ${extra}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>If the Board doesn’t act</h2>
        <ol style={{ paddingLeft: '1.2em', margin: 0 }}>
          <li><b>Written notice</b> to the Board via the manager. A dated letter builds the record. <Link to="/requests/new?type=maintenance">Maintenance notice</Link></li>
          <li><b>Meet and confer</b> (<S id="12.5" />). The Board must answer in writing within 30 days and can’t refuse. <Link to="/requests/new?type=meet_confer">Start</Link></li>
          <li><b>Request for Resolution</b> (Civ. Code §5935): mediation, usually required before suing. <Link to="/requests/new?type=adr_request">Start</Link></li>
          <li><b>Small claims or an attorney.</b> The prevailing party recovers attorneys’ fees (<S id="14.9" />). Any owner may enforce the governing documents (<S id="12.1" />), and past non-enforcement isn’t a waiver (<S id="12.3" />).</li>
        </ol>
      </div>

      <div className="card">
        <h2>Changing the Board</h2>
        <p>
          With 22 members, removing a director mid-term takes a majority of <b>all</b> members, which is <b>12 votes</b>, whatever the turnout
          (Corp. Code §7222). A petition from 5% of members (2 owners) can call a special meeting, which must be held 35–90 days after the
          petition. The other route is to run candidates at the regular annual election. The Civil Code and Corporations Code timing rules
          conflict, so talk to an HOA attorney first, and check the bylaws (not yet in hand).
        </p>
        <Link className="btn" to="/requests/new?type=special_meeting">Draft a special-meeting petition</Link>
      </div>
    </>
  )
}
