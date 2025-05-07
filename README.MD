 Example use:

/**
 * Selector to filter wishlist items based on various criteria.
 *
 * @param {RootState} state - The Redux state.
 * @param {WishlistFilters} filters - The filtering criteria.
 * @returns {WishlistItemType[]} Filtered wishlist items.
 */
export const selectFilteredWishlistItems = createSelector(
  [
    selectAllWishlistItems,
    (_: RootState, filters: WishlistFilters) => filters,
  ],
  (items: WishlistItemType[], filters: WishlistFilters): WishlistItemType[] => {
    return items
      .filter((item) => {
        if (!item) return false;


        const matchesPrice =
          !filters.priceRange ||
          ((filters.priceRange.min === undefined ||
            (item.price?.amount !== undefined && item.price.amount >= filters.priceRange.min)) &&
            (filters.priceRange.max === undefined ||
              (item.price?.amount !== undefined && item.price.amount <= filters.priceRange.max)));


        const matchesAvailability =
          !filters.availability ||
          (item.availability?.inStock === filters.availability.inStock &&
            (filters.availability.quantity === undefined ||
              item.availability.quantity === filters.availability.quantity));


        const matchesAddedAfter = !filters.addedAfter || (item.addedDate && item.addedDate >= filters.addedAfter);
        const matchesAddedBefore = !filters.addedBefore || (item.addedDate && item.addedDate <= filters.addedBefore);


        const matchesCategory =
          !filters.categories ||
          filters.categories.length === 0 ||
          (item.category && filters.categories.includes(item.category));
        const matchesTags =
          !filters.tags ||
          filters.tags.length === 0 ||
          item.tags?.some((tag) => filters.tags!.includes(tag));
        const matchesPriority = !filters.priority || item.priority === filters.priority;
        const matchesPriceChangeOnly = !filters.priceChangeOnly || item.hasPriceChanged;
        const matchesHasNotes = !filters.hasNotes || !!item.notes;
        const matchesIsPublic =
          filters.isPublic === undefined || item.isPublic === filters.isPublic;
        const matchesHasAlerts = !filters.hasAlerts || item.hasAlerts;


        return (
          matchesPrice &&
          matchesAvailability &&
          matchesAddedAfter &&
          matchesAddedBefore &&
          matchesCategory &&
          matchesTags &&
          matchesPriority &&
          matchesPriceChangeOnly &&
          matchesHasNotes &&
          matchesIsPublic &&
          matchesHasAlerts
        );
      })
      .sort((a, b) => {
        if (!a || !b) return 0;
        if (filters.sortBy === 'price') {
          const priceA = a.price?.amount ?? 0;
          const priceB = b.price?.amount ?? 0;
          return filters.sortOrder === SortDirection.ASC ? priceA - priceB : priceB - priceA;
        }
        if (filters.sortBy === 'date') {
          const dateA = a.addedDate ?? 0;
          const dateB = b.addedDate ?? 0;
          return filters.sortOrder === SortDirection.ASC
            ? dateA - dateB
            : dateB - dateA;
        }
        return 0;
      });
  }
);



// Example of a parameterized selector for filtering wishlist items
export const selectParameterizedWishlistItems = createParameterizedSelector(
  (state: RootState, filters: WishlistFilters) => {
    return selectFilteredWishlistItems(state, filters);
  },
  { maxSize: 20 }
);


// Example of a simpler parameterized selector for product-specific items
export const selectWishlistItemsByProductId = createParameterizedSelector(
  (state: RootState, productId: string, maxItems?: number) => {
    const items = selectAllWishlistItems(state).filter(
      (item) => 'productId' in item && item.productId === productId
    );
    return maxItems ? items.slice(0, maxItems) : items;
  },
  { maxSize: 20 }
);
