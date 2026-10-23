import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  FUEL_NAME_MAX,
  FUEL_SERVING_CARBS_MAX_G,
  FUEL_SERVING_KCAL_MAX,
  FUEL_SERVING_LABEL_MAX,
  FUEL_SERVING_SODIUM_MAX_MG,
} from '../../../shared/limits.ts'
import type { FuelProduct, FuelProductKind } from '../../../shared/types.ts'
import { useCreateFuelProduct, useUpdateFuelProduct, type FuelProductBody } from '../../api/fuel.ts'
import { ApiError, fieldErrors } from '../../api/client.ts'
import { Button } from '../Button.tsx'
import { Field, Input, Select } from '../Field.tsx'
import { useToast } from '../Toast.tsx'
import { labText } from './fuelText.ts'
import styles from './FuelLab.module.css'

const KINDS: readonly FuelProductKind[] = [
  'gel',
  'drink',
  'chew',
  'bar',
  'food',
  'electrolyte',
  'other',
]

/** The fields that show their own message. */
const FIELDS = ['name', 'servingLabel', 'carbsG', 'sodiumMg', 'kcal']

/** Grams of carbohydrate: a number from zero to the server's limit, or null. */
function parseGrams(text: string): number | null {
  if (text.trim() === '') return null
  const value = Number(text)
  return Number.isFinite(value) && value >= 0 && value <= FUEL_SERVING_CARBS_MAX_G ? value : null
}

/** An optional whole number: null when empty, undefined when it is not a number in range. */
function parseOptionalWhole(text: string, max: number): number | null | undefined {
  if (text.trim() === '') return null
  const value = Number(text)
  return Number.isInteger(value) && value >= 0 && value <= max ? value : undefined
}

export interface ProductFormProps {
  /** The product to change; null adds a new one. */
  product: FuelProduct | null
  /** The form is finished: the product was saved, or the runner cancelled. */
  onClose: () => void
}

/**
 * Adds a product to the list or changes one: its name, kind, what one serving is, and the
 * carbohydrate, sodium and energy in it. A value that cannot be saved is said beside its field,
 * from this form or from the server; a refusal the form cannot place (a full list, no connection)
 * is an alert above the buttons, and nothing the runner typed is lost.
 */
export function ProductForm({ product, onClose }: ProductFormProps) {
  const create = useCreateFuelProduct()
  const update = useUpdateFuelProduct()
  const toast = useToast()
  const first = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(product?.name ?? '')
  const [kind, setKind] = useState<FuelProductKind>(product?.kind ?? 'gel')
  const [serving, setServing] = useState(product?.servingLabel ?? '')
  const [carbs, setCarbs] = useState(product === null ? '' : String(product.carbsG))
  const [sodium, setSodium] = useState(product?.sodiumMg == null ? '' : String(product.sodiumMg))
  const [kcal, setKcal] = useState(product?.kcal == null ? '' : String(product.kcal))
  const [multiCarb, setMultiCarb] = useState(product?.multiCarb ?? false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const pending = create.isPending || update.isPending

  useEffect(() => {
    first.current?.focus()
  }, [])

  function submit(event: FormEvent): void {
    event.preventDefault()
    const found: Record<string, string> = {}
    const trimmedName = name.trim()
    const servingLabel = serving.trim()
    const carbsG = parseGrams(carbs)
    const sodiumMg = parseOptionalWhole(sodium, FUEL_SERVING_SODIUM_MAX_MG)
    const kcalValue = parseOptionalWhole(kcal, FUEL_SERVING_KCAL_MAX)
    if (trimmedName === '') found['name'] = labText.productNameRequired()
    if (servingLabel === '') found['servingLabel'] = labText.productServingRequired()
    if (carbsG === null) found['carbsG'] = labText.productCarbsInvalid()
    if (sodiumMg === undefined) found['sodiumMg'] = labText.productNumberInvalid()
    if (kcalValue === undefined) found['kcal'] = labText.productNumberInvalid()
    setErrors(found)
    setFailure(null)
    if (
      Object.keys(found).length > 0 ||
      carbsG === null ||
      sodiumMg === undefined ||
      kcalValue === undefined
    ) {
      return
    }

    const body: FuelProductBody = {
      name: trimmedName,
      kind,
      servingLabel,
      carbsG,
      sodiumMg,
      kcal: kcalValue,
      multiCarb,
    }
    const request =
      product === null ? create.mutateAsync(body) : update.mutateAsync({ id: product.id, body })
    request.then(
      () => {
        toast.show(labText.productSaved())
        onClose()
      },
      (error: unknown) => {
        const placed = fieldErrors(error)
        if (FIELDS.some((field) => field in placed)) {
          setErrors(placed)
          return
        }
        // A taken name is the one conflict that belongs to a field; a full list belongs to the form.
        const details = error instanceof ApiError ? (error.details as { code?: string }) : null
        if (error instanceof ApiError && error.status === 409 && details?.code === 'name-taken') {
          setErrors({ name: error.message })
          return
        }
        const reason = Object.values(placed)[0] ?? (error instanceof Error ? error.message : '')
        setFailure(labText.productNotSaved(reason))
      },
    )
  }

  return (
    <form
      noValidate
      aria-label={product === null ? labText.addProduct() : labText.editProduct(product.name)}
      className={styles.fields}
      onSubmit={submit}
    >
      <Field label={labText.productName()} error={errors['name']}>
        {(a) => (
          <Input
            {...a}
            ref={first}
            type="text"
            maxLength={FUEL_NAME_MAX}
            value={name}
            onChange={(event) => {
              setName(event.target.value)
            }}
          />
        )}
      </Field>
      <Field label={labText.productKind()}>
        {(a) => (
          <Select
            {...a}
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as FuelProductKind)
            }}
          >
            {KINDS.map((option) => (
              <option key={option} value={option}>
                {labText.kind(option)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        label={labText.productServing()}
        hint={labText.productServingHint()}
        error={errors['servingLabel']}
      >
        {(a) => (
          <Input
            {...a}
            type="text"
            maxLength={FUEL_SERVING_LABEL_MAX}
            value={serving}
            onChange={(event) => {
              setServing(event.target.value)
            }}
          />
        )}
      </Field>
      <Field label={labText.productCarbs()} error={errors['carbsG']}>
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
          />
        )}
      </Field>
      <Field label={labText.productSodium()} error={errors['sodiumMg']}>
        {(a) => (
          <Input
            {...a}
            type="number"
            inputMode="numeric"
            min={0}
            value={sodium}
            onChange={(event) => {
              setSodium(event.target.value)
            }}
          />
        )}
      </Field>
      <Field label={labText.productKcal()} error={errors['kcal']}>
        {(a) => (
          <Input
            {...a}
            type="number"
            inputMode="numeric"
            min={0}
            value={kcal}
            onChange={(event) => {
              setKcal(event.target.value)
            }}
          />
        )}
      </Field>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={multiCarb}
          onChange={(event) => {
            setMultiCarb(event.target.checked)
          }}
        />
        <span>{labText.productMulti()}</span>
      </label>
      {failure === null ? null : (
        <p role="alert" className={styles.error}>
          {failure}
        </p>
      )}
      <div className={styles.actions}>
        <Button type="submit" variant="primary" loading={pending}>
          {labText.productSave()}
        </Button>
        <Button variant="quiet" onClick={onClose}>
          {labText.productCancel()}
        </Button>
      </div>
    </form>
  )
}
