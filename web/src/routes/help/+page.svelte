<script lang="ts">
	import { resolve, asset } from '$app/paths';

	/**
	 * Written as plain English markup rather than through paraglide, exactly as the privacy
	 * page is. Both are long-form prose that is read once and edited as prose; routing every
	 * sentence through a message key would make it harder to keep accurate and buys nothing
	 * now the application ships in one language.
	 *
	 * It is a public route on purpose. Judges are handed their access link on the morning of
	 * an event and are not going to read anything they have to sign in to reach, so this way
	 * a Judge Advisor can send the link out the week before.
	 *
	 * The judges' section follows the same steps, in the same order and words, as the quick
	 * walkthrough video and the printed quick guide, so all three tell one story.
	 */

	interface Section {
		id: string;
		title: string;
	}

	const contents: Section[] = [
		{ id: 'judges', title: 'For judges' },
		{ id: 'advisors', title: 'For Judge Advisors' },
		{ id: 'referees', title: 'For referees' },
		{ id: 'trouble', title: 'When something goes wrong' },
		{ id: 'contact', title: 'Support and questions' }
	];

	const linkClass = 'text-blue-600 underline hover:text-blue-800';

	/**
	 * The walkthrough lives in Cloudflare R2, not on our server, so viewers download it
	 * straight from Cloudflare. R2 also answers the partial (range) requests iPhones need to
	 * play video. The poster is small and ships with the site.
	 */
	const walkthroughUrl = 'https://media.robotools.app/judges-walkthrough.mp4';
</script>

<svelte:head>
	<title>Help and Instructions | Robo Tools</title>
</svelte:head>

<div class="min-h-screen">
	<div class="flex min-h-screen flex-col bg-slate-100">
		<div class="flex flex-1 flex-col items-center justify-start p-4 sm:p-8">
			<div class="w-full max-w-4xl">
				<h1 class="mb-2 text-center text-4xl font-bold">Help and Instructions</h1>
				<p class="mb-8 text-center text-gray-600">Everything you need for the day, in the order you'll use it.</p>

				<div class="space-y-10 rounded-lg bg-white p-6 shadow-md sm:p-8">
					<!-- Quick guides, and the one rule that matters more than any feature. -->
					<div class="space-y-4">
						<div class="grid gap-3 sm:grid-cols-2">
							<a
								href={asset('/guides/judges-quick-guide.pdf')}
								target="_blank"
								rel="noopener"
								class="block rounded-lg border border-blue-200 bg-blue-50 p-4 hover:bg-blue-100"
							>
								<span class="block text-xs font-semibold tracking-wide text-blue-700 uppercase">Quick guide · PDF</span>
								<span class="block text-lg font-semibold text-gray-900">For judges</span>
								<span class="block text-sm text-gray-600">One page to print or keep on your phone.</span>
							</a>
							<a
								href={asset('/guides/refs-quick-guide.pdf')}
								target="_blank"
								rel="noopener"
								class="block rounded-lg border border-orange-200 bg-orange-50 p-4 hover:bg-orange-100"
							>
								<span class="block text-xs font-semibold tracking-wide text-orange-700 uppercase">Quick guide · PDF</span>
								<span class="block text-lg font-semibold text-gray-900">For referees</span>
								<span class="block text-sm text-gray-600">Logging notes at the field.</span>
							</a>
						</div>

						<div class="border-l-4 border-slate-400 bg-slate-50 p-4">
							<p class="leading-relaxed text-slate-800">
								<strong>Your link is your login. Keep it private.</strong> Anyone with your link can enter as you, so don't forward it and
								lock your device when you step away. <strong>Everything is confidential</strong>: rubrics, notes, photos and ratings are
								only seen by the judges and the Judge Advisor, and are deleted before the award ceremony.
							</p>
						</div>
					</div>

					<!-- Contents -->
					<nav class="rounded-lg border border-gray-200 p-4">
						<h2 class="mb-3 text-sm font-semibold tracking-wide text-gray-500 uppercase">On this page</h2>
						<ul class="grid gap-2 text-gray-700 sm:grid-cols-3">
							{#each contents as section (section.id)}
								<li><a href={`#${section.id}`} class={linkClass}>{section.title}</a></li>
							{/each}
						</ul>
					</nav>

					<!-- ============================================================ -->
					<section id="judges" class="scroll-mt-8 space-y-6">
						<div>
							<h2 class="mb-2 text-2xl font-semibold">For judges</h2>
							<p class="leading-relaxed text-gray-700">Works on a phone, tablet or laptop in any web browser. Nothing to install.</p>
						</div>

						<figure class="mx-auto w-full max-w-xs">
							<!-- preload="none": nothing downloads until someone presses play. -->
							<video
								src={walkthroughUrl}
								poster={asset('/guides/judges-walkthrough-poster.webp')}
								controls
								playsinline
								preload="none"
								class="aspect-[9/16] w-full rounded-lg border border-gray-200 bg-slate-100 shadow-sm"
							>
								<track kind="captions" />
							</video>
							<figcaption class="mt-2 text-center text-sm text-gray-600">
								Watch the two-minute walkthrough. It covers the four steps below.
							</figcaption>
						</figure>

						<div>
							<h3 class="mb-2 text-xl font-semibold">Get in</h3>
							<p class="leading-relaxed text-gray-700">
								Your Judge Advisor gives you a <strong>personal link</strong> or QR code, sometimes on a printed pass. Open it or scan it.
								You can also go to <a href={resolve('/app')} class={linkClass}>robotools.app/app</a>, paste it in and tap
								<strong>Join</strong>. There's no password. If you lose your link, ask the Judge Advisor for it again.
							</p>
						</div>

						<ol class="space-y-6">
							<li class="flex gap-4">
								<span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-700 font-semibold text-white">1</span>
								<div>
									<h3 class="mb-2 text-xl font-semibold">Overview</h3>
									<p class="mb-2 leading-relaxed text-gray-700">
										Opening your link brings you to <strong>Overview</strong>, your home page. Your name and judge group are at the top.
									</p>
									<p class="leading-relaxed text-gray-700">
										Every task starts here. Each one opens in its own tab, and you can tap <strong>Overview</strong> at any time to come back.
										Close a tab when you're done with it.
									</p>
								</div>
							</li>

							<li class="flex gap-4">
								<span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-700 font-semibold text-white">2</span>
								<div>
									<h3 class="mb-2 text-xl font-semibold">Notebook Sorting</h3>
									<p class="mb-2 leading-relaxed text-gray-700">
										Start with <strong>Notebook Sorting</strong>. This is where you view each team's notebook and do the first sort, before
										any rubric. Open the notebook link, give it a quick scan, then mark it <strong>Fully Developed</strong>,
										<strong>Developing</strong> or <strong>Not Submitted</strong>. If you're unsure between the first two, ask another judge
										or give it the benefit of the doubt.
									</p>
									<p class="mb-2 leading-relaxed text-gray-700">
										Once it's sorted, tap <strong>Start Rubric</strong> to score the notebook from 1 to 4 on each criterion. Work through
										each criterion, then tap <strong>Submit Rubric</strong> to save it.
									</p>
									<details class="text-gray-700">
										<summary class="cursor-pointer text-sm font-medium text-blue-700">More about sorting</summary>
										<ul class="mt-2 ml-4 list-disc space-y-2 text-sm leading-relaxed">
											<li>Fully Developed is required for the Design, Innovate and Excellence Awards.</li>
											<li>
												Tick <strong>Submitted with a Season Summary</strong> as you scan. GRSF asks for those notebooks to be scored first, and
												the lists put them at the top. It only records that a summary is there; summaries are never scored.
											</li>
											<li>
												A team with a notebook link can be scored straight away, without sorting first. You choose its category when you
												submit. As a guide, GRSF suggests 48 out of 64 for Fully Developed, but the call is yours.
											</li>
										</ul>
									</details>
								</div>
							</li>

							<li class="flex gap-4">
								<span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-700 font-semibold text-white">3</span>
								<div>
									<h3 class="mb-2 text-xl font-semibold">Interview</h3>
									<p class="mb-2 leading-relaxed text-gray-700">
										Open <strong>Team Interview</strong> and choose the team. The list shows your group's teams. Tap
										<strong>Take / Add Photos</strong> to snap images of the robot to refer back to later. If you need them, the
										<strong>sample questions</strong> in each section can help guide the conversation; two or three is plenty.
									</p>
									<p class="leading-relaxed text-gray-700">Score each criterion on what you hear:</p>
									<ul class="mt-1 mb-2 ml-4 list-disc space-y-1 text-gray-700">
										<li><strong>2 · Heard, with Specifics</strong>: the team gave concrete details</li>
										<li><strong>1 · Heard</strong>: the team addressed it generally</li>
										<li><strong>0 · Not Yet Heard</strong>: the team couldn't address it, even after a question</li>
									</ul>
									<p class="leading-relaxed text-gray-700">
										<strong>Listen-fors are examples.</strong> You don't need to hear all of them. Any one counts.
									</p>
								</div>
							</li>

							<li class="flex gap-4">
								<span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-700 font-semibold text-white">4</span>
								<div>
									<h3 class="mb-2 text-xl font-semibold">Submit &amp; rate</h3>
									<p class="mb-2 leading-relaxed text-gray-700">
										Add any notes, then tap <strong>Submit Rubric</strong>. It tells you if a criterion is still unscored. You can reopen
										and edit your own rubric later.
									</p>
									<p class="leading-relaxed text-gray-700">
										Then give the team <strong>0–5 stars</strong> for each award. Everyone in your judge group sees them straight away, and
										<strong>Award Ranking</strong> on Overview shows your group's stars for every team in one table.
									</p>
								</div>
							</li>
						</ol>

						<div class="rounded-lg bg-slate-50 p-4">
							<h3 class="mb-3 text-lg font-semibold">Good to know</h3>
							<ul class="ml-4 list-disc space-y-2 leading-relaxed text-gray-700">
								<li>
									<strong>The app saves and syncs for you.</strong> What you submit shows on every judge's device. If a tab has unsaved changes,
									the app warns you before it closes.
								</li>
								<li>
									<strong>Another judge's rubric is theirs.</strong> If you see a team differently, submit your own rubric for that team.
								</li>
								<li>
									<strong>Lost signal or the phone went to sleep?</strong> It reconnects by itself and catches up. The dot at the top turns green
									when you're connected.
								</li>
								<li>
									<strong>Your group's teams are shown by default.</strong> Untick the filter to see every team.
								</li>
								<li><strong>Left the room by mistake?</strong> Open your link again to get back in.</li>
							</ul>
						</div>

						<div>
							<h3 class="mb-3 text-lg font-semibold">Other tools on Overview</h3>
							<dl class="grid gap-3 sm:grid-cols-2">
								<div class="rounded-lg border border-gray-200 p-3">
									<dt class="font-semibold">Free time</dt>
									<dd class="text-sm text-gray-600">When each team next has a long enough gap between matches for an interview.</dd>
								</div>
								<div class="rounded-lg border border-gray-200 p-3">
									<dt class="font-semibold">Matches &amp; Skills</dt>
									<dd class="text-sm text-gray-600">Schedule, results and skills scores, so you don't need to find a field display.</dd>
								</div>
								<div class="rounded-lg border border-gray-200 p-3">
									<dt class="font-semibold">Team Attendance</dt>
									<dd class="text-sm text-gray-600">Mark teams that didn't turn up. Absent teams can't win Judged Awards.</dd>
								</div>
								<div class="rounded-lg border border-gray-200 p-3">
									<dt class="font-semibold">Note for the refs' record</dt>
									<dd class="text-sm text-gray-600">Pass something about one of your teams on to the referees.</dd>
								</div>
								<div class="rounded-lg border border-gray-200 p-3 sm:col-span-2">
									<dt class="font-semibold">Teams &amp; Rubrics</dt>
									<dd class="text-sm text-gray-600">
										Below the task list: every team's notebook link, the rubrics submitted for it, and its photos.
									</dd>
								</div>
							</dl>
						</div>

						<div>
							<h3 class="mb-2 text-lg font-semibold">Printable rubrics</h3>
							<p class="mb-3 leading-relaxed text-gray-700">
								Blank A4 rubrics for taking notes on paper, or as a fallback if a device fails. Scores still need entering in the app to
								count.
							</p>
							<div class="flex flex-wrap gap-3">
								<a href={resolve('/rubric/engineering-notebook-rubric')} target="_blank" rel="noopener">
									<button class="lightweight">Engineering Notebook Rubric</button>
								</a>
								<a href={resolve('/rubric/team-interview-rubric')} target="_blank" rel="noopener">
									<button class="lightweight">Team Interview Rubric</button>
								</a>
							</div>
						</div>
					</section>

					<!-- ============================================================ -->
					<section id="advisors" class="scroll-mt-8 space-y-6">
						<div>
							<h2 class="mb-2 text-2xl font-semibold">For Judge Advisors</h2>
							<p class="leading-relaxed text-gray-700">
								Everything judges can do, plus running the room. Each Judges' Room covers one division; an event with two divisions is two
								rooms.
							</p>
						</div>

						<div>
							<h3 class="mb-2 text-xl font-semibold">Before the day</h3>
							<ol class="ml-4 list-decimal space-y-2 leading-relaxed text-gray-700">
								<li>
									<strong>Create the event.</strong> Enter your name and an email address. The email is how you get your link back if you lose
									it.
								</li>
								<li>
									<strong>Add the event code</strong> from events.vex.com if the event is listed there. It imports the teams and awards, and turns
									on attendance, Matches, Skills and award eligibility.
								</li>
								<li>
									<strong>Set up judges and awards.</strong> Choose walk-in or pre-assigned judging, add judge groups and who is in each,
									then pick the awards. You can change any of this later from <strong>Change event setup</strong> or
									<strong>Judges overview</strong> in the menu.
								</li>
								<li>
									<strong>Send out links.</strong> Open <strong>Users</strong> in the menu to copy, email or show a QR code for each judge's
									link, or email everyone at once. Send them this page and the
									<a href={asset('/guides/judges-quick-guide.pdf')} target="_blank" rel="noopener" class={linkClass}>judges' quick guide</a
									>.
								</li>
							</ol>
						</div>

						<div>
							<h3 class="mb-2 text-xl font-semibold">On the day</h3>
							<ul class="ml-4 list-disc space-y-2 leading-relaxed text-gray-700">
								<li>
									<strong>A judge doesn't turn up?</strong> Use <strong>Judges overview</strong> to move their teams to another group.
								</li>
								<li>
									<strong>A device goes missing?</strong> In <strong>Users</strong>, <strong>rotate</strong> that person's link. The old link
									stops working straight away and you can hand out the new one.
								</li>
								<li>
									<strong>Excellence Award Candidates</strong> shows who meets the performance criteria (top 40% of qualification rankings, overall
									skills and autonomous coding skills) and the working behind each cut-off. It's provisional until deliberations start. For an
									event-wide Excellence Award across divisions, use the Tournament Manager report instead.
								</li>
								<li>
									<strong>Several divisions?</strong> Tie the rooms into an <strong>event group</strong> from <strong>Switch event</strong>
									so one link opens all of them.
								</li>
							</ul>
						</div>

						<div>
							<h3 class="mb-2 text-xl font-semibold">Deliberations</h3>
							<p class="mb-3 leading-relaxed text-gray-700">
								When interviews are finished, choose <strong>Start award deliberations</strong>. That opens three more tabs for everyone:
							</p>
							<ol class="ml-4 list-decimal space-y-2 leading-relaxed text-gray-700">
								<li>
									<strong>Award nominations</strong>: each judge group puts forward its top one or two teams per award. The app warns you if
									a team doesn't meet an award's requirements.
								</li>
								<li>
									<strong>Final ranking</strong>: drag nominees into order, with a first choice and three or more alternates. Pick
									Excellence winners by dragging a Design finalist into the Excellence column. Refresh from VEX Events before relying on the
									eligibility badges.
								</li>
								<li>
									<strong>Award winners</strong>: record the final results. <strong>Report</strong> gives a copyable list for the emcee. Enter
									the winners into Tournament Manager before the ceremony.
								</li>
							</ol>
						</div>

						<div>
							<h3 class="mb-2 text-xl font-semibold">After the awards are decided</h3>
							<p class="mb-2 leading-relaxed text-gray-700">
								<strong>Export results</strong> first. It saves a record of the outcome (no scores or judge notes) that you can print to
								PDF. Then <strong>Destroy judging data</strong> deletes everything, including rubrics, notes, photos and links. The judging guidelines
								require this before the award ceremony, and it can't be undone.
							</p>
							<p class="text-sm leading-relaxed text-gray-600">
								An event nobody opens for seven days is deleted automatically, with a warning email on the sixth.
							</p>
						</div>

						<div>
							<h3 class="mb-2 text-xl font-semibold">Connecting to VEX Events</h3>
							<p class="mb-2 leading-relaxed text-gray-700">
								For live data to arrive, the Event Partner must turn on publishing live results in Tournament Manager (Web Publish Setup).
								Without it, Matches, Skills and award eligibility stay empty.
							</p>
							<p class="leading-relaxed text-gray-700">
								For a multi-division event, set each team's division in Tournament Manager and publish <em>before</em> creating the rooms, then
								create one room per division. For digital notebooks, the Event Partner can download the notebook links report from VEX Events
								(Event Admin, then Downloads &amp; Links) and you can import it on Notebook Sorting to fill in every link at once.
							</p>
						</div>
					</section>

					<!-- ============================================================ -->
					<section id="referees" class="scroll-mt-8 space-y-4">
						<h2 class="text-2xl font-semibold">For referees</h2>
						<p class="leading-relaxed text-gray-700">
							Referees log incidents from their phone at the field, at <a href={resolve('/ref')} class={linkClass}>robotools.app/ref</a>.
							Your Head Referee gives you a personal link. Open it, then tap <strong>+ Log incident</strong>, choose the team, match,
							severity and rule, add a short note and tap <strong>Save</strong>. Every ref sees every note as it comes in.
						</p>
						<p class="leading-relaxed text-gray-700">
							The Judge Advisor can see ref notes when the judging room is linked. Tick <strong>Refs only</strong> for anything that's only
							useful on the field; those notes are never shared with judges. The
							<a href={asset('/guides/refs-quick-guide.pdf')} target="_blank" rel="noopener" class={linkClass}>referees' quick guide</a>
							covers the rest.
						</p>
					</section>

					<!-- ============================================================ -->
					<section id="trouble" class="scroll-mt-8">
						<h2 class="mb-4 text-2xl font-semibold">When something goes wrong</h2>

						<dl class="space-y-4 text-gray-700">
							<div>
								<dt class="font-semibold">The page says it is reconnecting</dt>
								<dd class="leading-relaxed">
									Leave it. It reconnects by itself and catches up. Anything you've typed but not submitted stays on your device.
								</dd>
							</div>
							<div>
								<dt class="font-semibold">My rubric won't submit</dt>
								<dd class="leading-relaxed">Every criterion needs a score. Look for a dash instead of a number.</dd>
							</div>
							<div>
								<dt class="font-semibold">I can't edit a rubric</dt>
								<dd class="leading-relaxed">Only the judge who wrote it can. Submit your own for the same team instead.</dd>
							</div>
							<div>
								<dt class="font-semibold">I was signed out</dt>
								<dd class="leading-relaxed">Your link was probably rotated. Ask the Judge Advisor for the new one.</dd>
							</div>
							<div>
								<dt class="font-semibold">The award tabs are missing</dt>
								<dd class="leading-relaxed">They appear once the Judge Advisor starts award deliberations.</dd>
							</div>
							<div>
								<dt class="font-semibold">Matches, Skills or eligibility are empty</dt>
								<dd class="leading-relaxed">
									The event isn't linked to VEX Events, or Tournament Manager isn't publishing live results. See
									<a href="#advisors" class={linkClass}>Connecting to VEX Events</a>.
								</dd>
							</div>
						</dl>
					</section>

					<!-- ============================================================ -->
					<section id="contact" class="scroll-mt-8">
						<h2 class="mb-4 text-2xl font-semibold">Support and questions</h2>
						<p class="mb-4 leading-relaxed text-gray-700">
							On the day, ask your Judge Advisor or Head Referee first. For anything else, including faults and suggestions, email
							<a href="mailto:contact@robotools.app" class={linkClass}>contact@robotools.app</a>. When reporting a fault, include the server
							version from <strong>Preferences</strong> in the menu and what you were doing. Please leave out team names, scores, notes and photos.
						</p>
						<div class="border-l-4 border-amber-400 bg-amber-50 p-4">
							<p class="leading-relaxed text-amber-900">
								<strong>On the day of an event</strong> we'll help as quickly as we can, but can't promise a fix while your event is still running.
								Keep the printable rubrics to hand. Everything already submitted is saved, and if the service has to restart, devices reconnect
								by themselves within a minute or two without losing your work.
							</p>
						</div>
					</section>

					<div class="border-t pt-4 text-center text-sm text-gray-500">
						<p>
							See also <a href={resolve('/privacy')} class={linkClass}>Data Protection and Privacy</a>.
						</p>
						<p class="mt-2">
							robotools.app is free software under the GPL v3.0:
							<a href="https://github.com/TakenFTG/robotoolsapp" target="_blank" rel="noopener noreferrer" class={linkClass}>source code</a>
							·
							<!-- Generated into the build by web/third-party-licenses.ts, so it 404s under `bun run dev`. -->
							<a href={asset('/third-party-licenses.txt')} target="_blank" rel="noopener" class={linkClass}>third-party licences</a>
						</p>
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
