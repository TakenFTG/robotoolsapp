<script lang="ts">
	const props = $props();
</script>

<svelte:head>
	<title>Data Protection and Privacy | Robo Tools</title>
</svelte:head>

<div class="min-h-screen">
	<div class="flex h-screen flex-col bg-slate-100">
		<div class="flex flex-1 flex-col items-center justify-start p-8">
			<div class="w-full max-w-4xl">
				<h1 class="mb-8 text-center text-4xl font-bold">Data Protection and Privacy</h1>

				<div class="space-y-8 rounded-lg bg-white p-8 shadow-md">
					<div>
						<h2 class="mb-4 text-2xl font-semibold">Introduction</h2>
						<p class="mb-4 leading-relaxed text-gray-700">
							When you use robotools.app, you're trusting us with your information and judging materials. We understand this is a big
							responsibility and are committed to protecting your privacy and handling all judging materials with the utmost
							confidentiality.
						</p>
						<p class="leading-relaxed text-gray-700">
							This policy explains what information we collect, why we collect it, and how you can control your data and judging materials.
						</p>
					</div>

					<div>
						<h2 class="mb-4 text-2xl font-semibold">Information We Collect</h2>

						<p class="mb-4 leading-relaxed text-gray-700">
							We do not collect analytics or usage data. This application contains no third-party analytics or tracking, and no usage data
							is sent anywhere for the purpose of measuring how the application is used.
						</p>
						<p class="leading-relaxed text-gray-700">
							The only information the server holds is what a Judges' Room or referee notes need in order to work: your event setup, teams,
							judges, rubrics and deliberation data, and the incidents referees log. That information exists so the devices at your event
							can share it with each other, it stays within the room that owns it, and destroying the room destroys it.
						</p>
					</div>

					<div>
						<h2 class="mb-4 text-2xl font-semibold">Administrator Access</h2>

						<p class="mb-4 leading-relaxed text-gray-700">
							The people who operate this service can see a list of the events that exist on it, in order to support and maintain it. For
							each event this shows:
						</p>
						<ul class="mb-4 ml-4 list-inside list-disc space-y-2 text-gray-700">
							<li>The event name, program, grade level, division and event code</li>
							<li>The names of the judges, and which judge group each is in</li>
							<li>The names of the Judge Advisors</li>
							<li>How many teams and devices are involved, and when the event was created</li>
						</ul>
						<p class="mb-4 leading-relaxed text-gray-700">
							<strong>No judging content is visible to administrators.</strong> Rubrics, scores, notes, award nominations, rankings, team photos
							and notebook links are not readable through this, by design.
						</p>
						<p class="leading-relaxed text-gray-700">
							Administrators can also delete an event, and add or remove judges from one, in order to resolve support requests. Access is
							protected by a separate password held by the operator and is not available to event participants.
						</p>
					</div>

					<div>
						<h2 class="mb-4 text-2xl font-semibold">Information We Store and Process</h2>

						<p class="mb-4 leading-relaxed text-gray-700">
							When you use robotools.app, you upload information about your event and create judging materials during the competition
							process. We store and process such data to provide the judging functionality:
						</p>
						<ul class="mb-4 ml-4 list-inside list-disc space-y-2 text-gray-700">
							<li><strong>Event Information:</strong> Event name, competition structure, award lists, and team lists</li>
							<li>
								<strong>Judging Materials:</strong> Links to team engineering notebooks, evaluation scores, rubrics, and award rankings
							</li>
							<li>
								<strong>Judge Notes:</strong> Observations, comments, and evaluations that may contain team member names or other personal information
							</li>
							<li><strong>Award Deliberations:</strong> Nominations, rankings, and final award decisions</li>
							<li>
								<strong>Email Addresses:</strong> Optional, for judges and for Judge Advisors alike. An address is recorded so that person can
								be sent their own access link, and is used for nothing else — no newsletters, no notifications, no sharing with anyone. A judge's
								address is stored in the event's own database and deleted when the event is destroyed. A Judge Advisor who administers several
								divisions through an event group has their address stored with that group instead, which outlives any one division and goes when
								the group does. Anyone who would rather not have an address stored can leave the field empty and be handed their link in person;
								the QR code exists for exactly that.
							</li>
							<li>
								<strong>Team Interview Photos:</strong> Pictures of robots or interview context captured by judges during team interviews. Photos
								may incidentally include people or team identifiers visible in the frame.
							</li>
						</ul>
					</div>

					<div>
						<h2 class="mb-4 text-2xl font-semibold">Referee Notes</h2>

						<p class="mb-4 leading-relaxed text-gray-700">
							Referees can use robotools.app to log incidents at the field and share them with the other referees at their event. Referee
							notes are kept in their own room, separate from any Judges' Room, with its own access links.
						</p>

						<h3 class="mb-3 text-xl font-semibold">What referee notes hold</h3>
						<ul class="mb-4 ml-4 list-inside list-disc space-y-2 text-gray-700">
							<li><strong>Event Information:</strong> Event name, program, divisions, and the team list (number, name and school)</li>
							<li><strong>Referees:</strong> Each referee's name and role, and an optional email address</li>
							<li>
								<strong>Incidents:</strong> For each one, the team, the match or skills run, the rules involved, how serious it was, a written
								note, whether it is for referees only, who logged it and when
							</li>
							<li><strong>Match Schedule:</strong> Read from VEX Events, or from a linked Judges' Room, and not stored</li>
						</ul>
						<p class="mb-4 leading-relaxed text-gray-700">
							Incidents are about what a team's robot or drive team did on the field. Referees should record what happened and avoid writing
							anything personal about a student beyond what the record needs.
						</p>

						<h3 class="mb-3 text-xl font-semibold">Who can see them</h3>
						<ul class="mb-4 ml-4 list-inside list-disc space-y-2 text-gray-700">
							<li>Every referee with a link to the event's referee notes can see every incident logged there.</li>
							<li>
								When the referee notes are linked to a division's Judges' Room, that division's <strong>Judge Advisors</strong> can see the incidents
								about that division's teams. Judges cannot.
							</li>
							<li>
								Incidents marked <strong>refs only</strong> are never shown to anyone outside the referee notes, whatever is linked. They are
								held back before anything leaves the referee notes.
							</li>
							<li>
								Linking works one way for judging data: the referee notes receive only that division's team list and match schedule. No
								rubric, score, judge note, nomination, ranking, photo or notebook link ever reaches the referees.
							</li>
							<li>The people who operate this service cannot view referee notes or incidents through any administration tool.</li>
						</ul>

						<h3 class="mb-3 text-xl font-semibold">Email addresses and links</h3>
						<p class="mb-4 leading-relaxed text-gray-700">
							Each referee has their own access link, which signs them in as themselves and should not be passed on. A referee's email
							address is optional and used only to send them their link when a Head Referee or Judge Advisor chooses to, and to warn Head
							Referees before inactive notes are deleted. It is stored with the event's referee notes and deleted with them.
						</p>

						<h3 class="mb-3 text-xl font-semibold">Deleting referee notes</h3>
						<p class="leading-relaxed text-gray-700">
							A Head Referee can delete the event's referee notes at any time, which deletes their database file outright: incidents,
							referees, email addresses and links together. Removing a referee stops their link working; incidents they logged are kept,
							with their name. Referee notes follow the same schedule as Judges' Rooms: after <strong>six days</strong> with nobody using
							them, Head Referees with an email address are warned, and after <strong>seven</strong> they are deleted permanently. Head Referees
							can export the incidents as a spreadsheet beforehand.
						</p>
					</div>

					<div>
						<h2 class="mb-4 text-2xl font-semibold">Keeping the Information Secure</h2>

						<p class="mb-4 leading-relaxed text-gray-700">
							We treat all data stored in the judges' room as highly sensitive information that must be protected at all times.
						</p>
						<p class="mb-4 leading-relaxed text-gray-700">
							robotools.app runs on infrastructure we operate directly. Each Judges' Room is stored in its own separate SQLite database on
							the server, and team interview photos are stored inside that same database rather than in any shared or public storage. One
							room cannot read another's data, and destroying a room deletes its database file outright — the judging data, the access links
							and the photos all go together, with nothing left behind in a second system.
						</p>
						<p class="mb-4 leading-relaxed text-gray-700">
							All communications between your browser and our servers are encrypted over TLS/SSL (HTTPS) to protect your data from being
							intercepted or tampered with. Server backups are held by us and are not shared with any third party.
						</p>
						<p class="mb-4 leading-relaxed text-gray-700">
							The software behind robotools.app is open source and can be run independently by anyone who prefers to keep their judging
							environment entirely under their own control. This privacy policy applies only to robotools.app. A separately operated
							installation is the responsibility of whoever runs it, including its data handling, privacy compliance and security.
						</p>
					</div>

					<div>
						<h2 class="mb-4 text-2xl font-semibold">Data Access and Control</h2>

						<div class="mb-6">
							<h3 class="mb-3 text-xl font-semibold">Who Can Access Your Data</h3>
							<p class="mb-4 leading-relaxed text-gray-700">
								When you join a judges' room, all individuals who can access the judges' room will have access to your input information,
								including any data you upload or create during the judging process.
							</p>
						</div>

						<div class="mb-6">
							<h3 class="mb-3 text-xl font-semibold">Confidentiality</h3>
							<p class="mb-4 leading-relaxed text-gray-700">
								Each person is given their own access link, which is the credential for the room. An access link identifies the person
								holding it, so anyone who has it can enter the room as that person. To protect the confidentiality of judging material,
								judges and Judge Advisors should not pass their link on to anyone else, and a Judge Advisor should reissue any link that
								goes astray. Event groups, and rooms created before links became individual, are additionally protected by a Judge Advisor
								PIN.
							</p>
						</div>

						<div class="mb-6">
							<h3 class="mb-3 text-xl font-semibold">Modifying Your Data</h3>
							<p class="mb-4 leading-relaxed text-gray-700">
								You can modify your data at any time while the judges' room is active. This includes updating your evaluations, notes, and
								any other information you've contributed to the judging process.
							</p>
						</div>

						<div>
							<h3 class="mb-3 text-xl font-semibold">Deleting Your Information</h3>
							<p class="mb-4 leading-relaxed text-gray-700">
								To delete your information, you can ask your judge advisor to remove your name from the Event Setup page, or request that
								the entire judges' room be destroyed. Each judges' room is a single database file, holding its judging data, its access
								links, any recorded email addresses and its interview photos. Destroying the room deletes that file outright, and the data
								cannot be restored.
							</p>
							<p class="mb-4 leading-relaxed text-gray-700">
								A room that is created but never used is discarded automatically within the hour.
							</p>
							<p class="leading-relaxed text-gray-700">
								Events are also deleted on a schedule, so that judging material does not sit on the server indefinitely because nobody
								remembered to remove it. After <strong>six days</strong> with nobody using an event, the Judge Advisor is emailed a warning;
								after <strong>seven</strong>, the event is deleted permanently — rubrics, notes, photos and access links together. An event
								with anyone connected is never deleted, and simply opening one resets the clock. Judge Advisors can export the award winners
								and the deliberation record as a PDF beforehand; that export deliberately excludes rubric scores and judge notes.
							</p>
						</div>
					</div>

					<div>
						<h2 class="mb-4 text-2xl font-semibold">Compliance</h2>
						<p class="mb-4 leading-relaxed text-gray-700">
							In accordance with the Global Robotics &amp; Science Foundation (GRSF) VEX Competition judging guidelines confidentiality
							principles, <strong>all judging materials are strictly confidential</strong>. We treat all data stored in the judges' room as
							highly sensitive information that must be protected at all times.
						</p>

						<div class="mb-6 border-l-4 border-slate-400 bg-slate-50 p-4">
							<h3 class="mb-2 font-semibold text-slate-800">Confidential Materials Include:</h3>
							<ul class="ml-4 list-inside list-disc space-y-1 text-slate-700">
								<li>Links to team engineering notebooks</li>
								<li>Submitted rubrics and evaluation scores</li>
								<li>Judge notes and observations</li>
								<li>Award rankings and deliberations</li>
								<li>Award nominations and finalist selections</li>
								<li>Final award winners</li>
								<li>Team interview / robot photos</li>
								<li>Any other judging-related documentation</li>
							</ul>
						</div>

						<p class="mb-4 leading-relaxed text-gray-700">
							While we do store and process your judging materials as necessary to provide the service functionality, we maintain strict
							confidentiality protocols. Your judging data is never shared with third parties or external services beyond our secure
							infrastructure. We do not maintain logs or records of judging content for purposes other than providing the judging system
							functionality. When the Judge Advisor confirms to destroy the data at the end of the event, all judging materials are
							permanently deleted and cannot be restored.
						</p>

						<p class="leading-relaxed text-gray-700">
							This approach ensures complete compliance with the judging confidentiality requirements outlined in the Confidential principle
							for judges and the Secure materials step of judging deliberations in the GRSF judging guidelines. robotools.app is designed to
							fully comply with GRSF requirements, particularly regarding confidentiality, impartiality, and proper handling of judging
							materials.
						</p>
					</div>

					<div>
						<h2 class="mb-4 text-2xl font-semibold">Updates to This Privacy Policy</h2>
						<p class="leading-relaxed text-gray-700">
							We may update this privacy policy from time to time to reflect changes in our practices or applicable regulations. Any
							significant changes will be communicated through the application interface. We encourage users to review this policy
							periodically.
						</p>
					</div>

					<div>
						<h2 class="mb-4 text-2xl font-semibold">Contact Us</h2>
						<p class="leading-relaxed text-gray-700">
							If you have any questions or concerns about this privacy policy, our data handling practices, or the robotools.app
							application, please contact us at <a href="mailto:contact@robotools.app" class="font-semibold underline hover:text-blue-900"
								>contact@robotools.app</a
							>.
						</p>
					</div>

					<div class="border-t pt-4 text-center text-sm text-gray-500">
						<p>Last updated: October 2026</p>
					</div>
				</div>
			</div>
		</div>
	</div>
</div>

<style lang="postcss">
	@reference '../../app.css';

	:global {
		body {
			@apply bg-slate-100;
		}
	}
</style>
