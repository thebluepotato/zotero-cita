import { IndexedWork, IndexerBase, LookupIdentifier } from "./indexer";
import Lookup from "./zotLookup";
import Wikicite, { debug } from "./wikicite";

interface OCWork {
	title: string;
	issue: string;
	author: string;
	publisher: string;
	editor: string;
	pub_date: string;
	id: string;
	type: string;
	page: string;
	venue: string;
	volume: string;
}

interface OCCitation {
	cited: string;
	journal_sc: string; // yes/no
	author_sc: string; // yes/no
	timespan: string;
	creation: string;
	oci: string;
	citing: string;
}

// Based on API documentation, should support (doi|issn|isbn|omid|openalex|pmid|pmcid)
// Only for fecthing OMID from OpenCitation Meta
/*type SupportedUID =
	| { DOI: string }
	| { ISSN: string }
	| { ISBN: string }
	| { OMID: string } // OpenCitations Metadata Identifier
	| { openAlex: string }
	| { PMID: string }
	| { PMCID: string };*/

export default class OpenCitations extends IndexerBase<OCCitation> {
	indexerName = "Open Citations";

	/**
	 * Supported PIDs for OpenCitations
	 * For searching citations, a smaller set of identifiers is supported
	 */
	supportedPIDs: PIDType[] = ["DOI", "OMID", "PMID"];

	getReferences(
		identifiers: LookupIdentifier[],
	): Promise<IndexedWork<OCCitation>[]> {
		const requests = identifiers.map(async (uid) => {
			let param = "";
			switch (uid.type) {
				case "DOI":
					param = `doi:${uid.id}`;
					break;
				case "OMID":
					param = `omid:${uid.id}`;
					break;
				case "PMID":
					param = `pmid:${uid.id}`;
					break;
			}
			const url = `https://opencitations.net/index/api/v2/references/${param}`;
			const options = {
				headers: {
					"User-Agent": `${Wikicite.getUserAgent()} mailto:cita@duck.com`,
				},
				responseType: "json",
			};
			const response = await Zotero.HTTP.request(
				"GET",
				url,
				options,
			).catch((e) => {
				debug(`Couldn't access URL: ${url}. Got status ${e.status}.`);
			});

			const citedWorks = response?.response as OCCitation[];
			return {
				referenceCount: citedWorks.length,
				referencedWorks: citedWorks,
			};
		});
		return Promise.all(requests);
	}

	async parseReferences(references: OCCitation[]): Promise<Zotero.Item[]> {
		if (!references.length) {
			debug(
				"Item found on OpenCitations but doesn't contain any references",
			);
			return [];
		}

		// Extract one identifier per reference (prioritising DOI) and filter out those without identifiers
		const _identifiers = references.map((citation) => {
			// Should be one of (doi|issn|isbn|omid|openalex|pmid|pmcid)
			return citation.cited
				.split(" ")
				.map((e) => e.split(":", 2))
				.map((e) => {
					return { type: e[0], value: e[1] };
				})
				.filter((e) =>
					["doi", "pmid", "pmcid", "openalex"].includes(e.type),
				)
				.sort((a, b) => {
					// Select best DOI > PMID > ISBN > openAlex
					if (a.type === "doi") return -1;
					if (b.type === "doi") return 1;
					if (a.type === "pmid") return -1;
					if (b.type === "pmid") return 1;
					if (a.type === "isbn") return -1;
					if (b.type === "isbn") return 1;
					if (a.type === "openalex") return -1;
					if (b.type === "openalex") return 1;
					return 0;
				})[0]; // return the first one
		});
		// Extract identifiers
		const identifiers = _identifiers
			.filter(
				(e) =>
					e.type === "doi" || e.type === "pmid" || e.type === "pmcid",
			)
			.map((e) => e.value)
			.flatMap(Zotero.Utilities.extractIdentifiers);
		const openAlexIdentifiers = _identifiers
			.filter((e) => e.type === "openalex")
			.map((e) => e.value);

		// Use Lookup to get items for all identifiers
		const result = await Lookup.lookupItemsByIdentifiers(identifiers);
		const parsedReferences = result ? result : [];

		const openAlexResult =
			await Lookup.lookupItemsOpenAlex(openAlexIdentifiers);
		if (openAlexResult) parsedReferences.push(...openAlexResult);

		return parsedReferences;
	}
}
