import SourceItemWrapper from "./sourceItemWrapper";
import Progress from "./progress";
import Citation from "./citation";
import Wikicite from "./wikicite";
import Bottleneck from "bottleneck";

// TODO: limiter should debend on indexer
// Initialize Bottleneck for rate limiting (max 50 requests per second)
const limiter = new Bottleneck({
	minTime: 20, // 50 requests per second
});

declare const Services: any;

//export type OpenAlexID = `W${number}`;
export type UID =
	| { DOI: string }
	| { ISBN: string }
	| { arXiv: string }
	| { openAlex: string }
	| { semantic: string }
	| { OMID: string }
	| { adsBibcode: string }
	| { PMID: string }
	| { PMCID: string };

export interface IndexedWork<Ref> {
	referenceCount: number;
	referencedWorks: Ref[];
}

export abstract class IndexerBase<Ref, SupportedUID> {
	/**
	 * Name of the indexer to be displayed.
	 */
	abstract indexerName: string;

	/**
	 * Extract supported UID from the source item.
	 * @param item Source item to extract the UID from.
	 */
	abstract extractSupportedUID(item: SourceItemWrapper): SupportedUID | null;

	/**
	 * Abstract method to get references from the specific indexer.
	 * @param {SupportedUID[]} identifiers - List of DOIs or other identifiers.
	 * @returns {Promise<IndexedWork[]>} Corresponding works.
	 */
	abstract getReferences(
		identifiers: SupportedUID[],
	): Promise<IndexedWork<Ref>[]>;

	/**
	 * Abstract method to parse a list of references into Zotero items.
	 * @param {Ref[]} references - References for a specific work.
	 * @returns {Promise<Zotero.Item[]>} Zotero items parsed from the references.
	 */
	abstract parseReferences(references: Ref[]): Promise<Zotero.Item[]>;

	/**
	 * Filter source items with supported UIDs.
	 * @param sourceItems Selected items to filter depending on the indexer.
	 */
	filterItemsWithSupportedUIDs(
		sourceItems: SourceItemWrapper[],
	): [sourceItems: SourceItemWrapper[], identifiers: SupportedUID[]] {
		const identifiers: SupportedUID[] = [];
		const filteredItems: SourceItemWrapper[] = [];

		for (const item of sourceItems) {
			const uid = this.extractSupportedUID(item);
			if (uid) {
				identifiers.push(uid);
				filteredItems.push(item);
			}
		}

		return [filteredItems, identifiers];
	}

	/**
	 * Get source item citations from the online database.
	 * @param {SourceItemWrapper[]} sourceItems - One or more source items to get citations for.
	 */
	async addCitationsToItems(
		sourceItems: SourceItemWrapper[],
		autoLinkCitations = true,
	) {
		// Filter items with valid identifiers (DOI or other)
		const [fetchableSourceItems, identifiers] =
			this.filterItemsWithSupportedUIDs(sourceItems);
		if (fetchableSourceItems.length === 0) {
			Services.prompt.alert(
				window,
				Wikicite.formatString(
					"wikicite.indexer.get-citations.no-doi-title",
					this.indexerName,
				),
				Wikicite.formatString(
					"wikicite.indexer.get-citations.no-doi-message",
					this.indexerName,
				),
			);
			return;
		}

		// Ask user confirmation in case some selected items already have citations
		if (fetchableSourceItems.some((item) => item.citations.length)) {
			const confirmed = Services.prompt.confirm(
				window,
				Wikicite.getString(
					"wikicite.indexer.get-citations.existing-citations-title",
				),
				Wikicite.formatString(
					"wikicite.indexer.get-citations.existing-citations-message",
					this.indexerName,
				),
			);
			if (!confirmed) return;
		}

		// Get reference information
		const progress = new Progress(
			"loading",
			Wikicite.formatString(
				"wikicite.indexer.get-citations.loading",
				this.indexerName,
			),
		);

		const sourceItemReferences = await limiter
			.schedule(() => this.getReferences(identifiers))
			.catch((error) => {
				Zotero.log(`Error fetching references: ${error}`);
				return [];
			});

		// Confirm with the user to add citations
		const numberOfCitations: number[] = sourceItemReferences.map(
			(ref) => ref.referenceCount,
		);
		const itemsToBeUpdated = numberOfCitations.filter((n) => n > 0).length;
		const citationsToBeAdded = numberOfCitations.reduce(
			(sum, n) => sum + n,
			0,
		);
		if (citationsToBeAdded === 0) {
			progress.updateLine(
				"error",
				Wikicite.formatString(
					"wikicite.indexer.get-citations.no-references",
					this.indexerName,
				),
			);
			return;
		}

		const confirmed = Services.prompt.confirm(
			window,
			Wikicite.formatString(
				"wikicite.indexer.get-citations.confirm-title",
				this.indexerName,
			),
			Wikicite.formatString(
				"wikicite.indexer.get-citations.confirm-message",
				[itemsToBeUpdated, sourceItems.length],
			) +
				"\n\n" +
				Wikicite.formatString(
					"wikicite.indexer.get-citations.confirm-message-count",
					citationsToBeAdded,
				),
		);
		if (!confirmed) {
			progress.close();
			return;
		}

		// Parse the references and add them to the items
		progress.updateLine(
			"loading",
			Wikicite.formatString(
				"wikicite.indexer.get-citations.parsing",
				this.indexerName,
			),
		);

		try {
			let parsedItems = 0;
			const parsedItemReferences = await Promise.all(
				sourceItemReferences.map(async (work) => {
					if (!work.referenceCount) return [];
					const parsedReferences = await this.parseReferences(
						work.referencedWorks,
					);
					progress.updateLine(
						"loading",
						Wikicite.formatString(
							"wikicite.indexer.get-citations.parsing-progress",
							[++parsedItems, itemsToBeUpdated],
						),
					);
					return parsedReferences;
				}),
			);

			const refsFound = parsedItemReferences
				.map((ref) => ref.length)
				.reduce((sum, n) => sum + n, 0);

			await Zotero.DB.executeTransaction(async () => {
				fetchableSourceItems.forEach((sourceItem, index) => {
					const newCitedItems = parsedItemReferences[index];
					if (newCitedItems.length > 0) {
						const newCitations = newCitedItems.map(
							(newItem) =>
								new Citation(
									{ item: newItem, ocis: [] },
									sourceItem,
								),
						);
						sourceItem.addCitations(newCitations);
						if (autoLinkCitations) sourceItem.autoLinkCitations();
					}
				});
			});

			// Auto-linking
			// FIXME: even though this is the same code as in localCitationNetwork, items are not updated. Workaround is to open the citation network
			/*if (autoLinkCitations) {
                Zotero.log("Auto-linking citations");
                const libraryID = sourceItemsWithDOI[0].item.libraryID;
                const matcher = new Matcher(libraryID);
                progress.updateLine(
                    'loading',
                    Wikicite.getString('wikicite.source-item.auto-link.progress.loading')
                    );
                await matcher.init();
                for (const wrappedItem of sourceItemsWithDOI) {
                    wrappedItem.autoLinkCitations(matcher, true);
                }
            }*/

			progress.updateLine(
				"done",
				Wikicite.formatString("wikicite.indexer.get-citations.done", [
					refsFound,
					citationsToBeAdded,
					this.indexerName,
				]),
			);
		} catch (error) {
			progress.updateLine(
				"error",
				Wikicite.formatString(
					"wikicite.indexer.get-citations.error-parsing-references",
					this.indexerName,
				),
			);
			Zotero.log(`Adding citations failed due to error: ${error}`);
		} finally {
			progress.close();
		}
	}
}
