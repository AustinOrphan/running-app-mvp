import { useId, useState, type KeyboardEvent } from 'react'
import { FUEL_NAME_MAX, FUEL_SERVING_CARBS_MAX_G } from '../../../shared/limits.ts'
import type { FuelProduct } from '../../../shared/types.ts'
import { Button } from '../Button.tsx'
import { Field, Input } from '../Field.tsx'
import { servingsOf, type FormItem, type FormState } from './fuelForm.ts'
import { fuelText } from './fuelText.ts'
import styles from './ProductPicker.module.css'

export interface ProductPickerProps {
  /** The runner's live products. */
  products: FuelProduct[]
  state: FormState
  /** Whether an earlier log has products to repeat ("Same as last long run"). */
  canRepeat: boolean
  /** The live total sentence, or null before anything is taken. */
  total: string | null
  onRepeat: () => void
  onAdd: (product: FuelProduct) => void
  onRemove: (product: FuelProduct) => void
  onAddFood: (food: FormItem) => void
  onRemoveFood: (food: FormItem) => void
}

/**
 * What the runner took: "Same as last long run", a chip for each product on the list that adds one
 * with a step back and a count once something is taken, "Something else" for food that is not on
 * the list, and the live total. Every control is a tap, so a log needs no typing; the two fields of
 * "Something else" are the only place that asks for it.
 */
export function ProductPicker({
  products,
  state,
  canRepeat,
  total,
  onRepeat,
  onAdd,
  onRemove,
  onAddFood,
  onRemoveFood,
}: ProductPickerProps) {
  const live = new Set(products.map((product) => product.id))
  const foods = state.items.filter((item) => item.productId === null || !live.has(item.productId))
  return (
    <fieldset className={styles.group}>
      <legend>{fuelText.productsLegend()}</legend>
      {canRepeat ? (
        <Button variant="secondary" onClick={onRepeat} className={styles.same}>
          {fuelText.sameAsLast()}
        </Button>
      ) : null}
      {products.length === 0 ? (
        <p className={styles.muted}>{fuelText.noProducts()}</p>
      ) : (
        <ul className={styles.products}>
          {products.map((product) => {
            const taken = servingsOf(state, product.id)
            return (
              <li key={product.id} className={styles.product}>
                <button
                  type="button"
                  className={styles.chip}
                  aria-label={fuelText.addOne(product.name)}
                  onClick={() => {
                    onAdd(product)
                  }}
                >
                  {product.name}
                </button>
                <span className={styles.serving}>{product.servingLabel}</span>
                {taken === 0 ? null : (
                  <span className={styles.stepper}>
                    <button
                      type="button"
                      className={styles.step}
                      aria-label={fuelText.removeOne(product.name)}
                      onClick={() => {
                        onRemove(product)
                      }}
                    >
                      −
                    </button>
                    <span className={styles.count}>{fuelText.taken(taken)}</span>
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <OwnFood foods={foods} onAdd={onAddFood} onRemove={onRemoveFood} />
      {total === null ? null : <output className={styles.total}>{total}</output>}
    </fieldset>
  )
}

/**
 * Food that is not on the list: the rows already added, and "Something else" to add one with its
 * name and the grams of carbohydrate in it.
 */
function OwnFood({
  foods,
  onAdd,
  onRemove,
}: {
  foods: FormItem[]
  onAdd: (food: FormItem) => void
  onRemove: (food: FormItem) => void
}) {
  const panelId = useId()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [carbs, setCarbs] = useState('')
  const [invalid, setInvalid] = useState(false)

  function add(): void {
    const grams = Number(carbs)
    const trimmed = name.trim()
    if (
      trimmed === '' ||
      trimmed.length > FUEL_NAME_MAX ||
      carbs.trim() === '' ||
      !Number.isFinite(grams) ||
      grams < 0 ||
      grams > FUEL_SERVING_CARBS_MAX_G
    ) {
      setInvalid(true)
      return
    }
    onAdd({
      productId: null,
      name: trimmed,
      carbsG: grams,
      sodiumMg: null,
      kcal: null,
      multiCarb: false,
      servings: 1,
    })
    setName('')
    setCarbs('')
    setInvalid(false)
    setOpen(false)
  }

  /** Enter in these fields adds the food; it must not save the whole log. */
  function addOnEnter(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== 'Enter') return
    event.preventDefault()
    add()
  }

  return (
    <div className={styles.own}>
      {foods.length === 0 ? null : (
        <ul className={styles.foods}>
          {foods.map((food, index) => (
            <li key={`${food.name}:${String(index)}`} className={styles.food}>
              <span>
                {fuelText.foodRow(
                  food.servings,
                  food.name,
                  Math.round(food.carbsG * food.servings),
                )}
              </span>
              <Button
                variant="quiet"
                aria-label={fuelText.foodRemove(food.name)}
                onClick={() => {
                  onRemove(food)
                }}
              >
                −
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button
        variant="secondary"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen(!open)
        }}
      >
        {fuelText.somethingElse()}
      </Button>
      <div id={panelId} hidden={!open}>
        {open ? (
          <div className={styles.foodForm}>
            <Field label={fuelText.foodName()}>
              {(a) => (
                <Input
                  {...a}
                  type="text"
                  maxLength={FUEL_NAME_MAX}
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value)
                  }}
                  onKeyDown={addOnEnter}
                />
              )}
            </Field>
            <Field label={fuelText.foodCarbs()}>
              {(a) => (
                <Input
                  {...a}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={carbs}
                  onChange={(event) => {
                    setCarbs(event.target.value)
                  }}
                  onKeyDown={addOnEnter}
                />
              )}
            </Field>
            {invalid ? (
              <p role="alert" className={styles.error}>
                {fuelText.foodInvalid()}
              </p>
            ) : null}
            <Button variant="secondary" onClick={add}>
              {fuelText.foodAdd()}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
